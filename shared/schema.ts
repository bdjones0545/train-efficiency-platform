import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, time, pgEnum, uniqueIndex, jsonb, doublePrecision, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export * from "./models/auth";
export * from "./models/chat";
import { users } from "./models/auth";

export const subscriptionStatusEnum = pgEnum("subscription_status", ["trialing", "active", "past_due", "canceled", "incomplete", "none"]);

export const ORG_TYPES = [
  "performance_facility",
  "sports_team",
  "sports_academy",
  "high_school_program",
  "college_program",
  "private_coach",
] as const;
export type OrgType = typeof ORG_TYPES[number];

export const organizations = pgTable("organizations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  slug: varchar("slug").notNull().unique(),
  logoUrl: text("logo_url"),
  organizationType: varchar("organization_type").default("performance_facility"),
  primarySport: varchar("primary_sport").default(""),
  improvementGoals: text("improvement_goals").array().default(sql`'{}'::text[]`),
  onboardingCompleted: boolean("onboarding_completed").default(false),
  ownerUserId: varchar("owner_user_id"),
  ownerEmail: varchar("owner_email"),
  tagline: text("tagline").default(""),
  tagline2: text("tagline2").default(""),
  primaryColor: varchar("primary_color").default(""),
  secondaryColor: varchar("secondary_color").default(""),
  emailPrimaryColor: varchar("email_primary_color").default(""),
  emailSecondaryColor: varchar("email_secondary_color").default(""),
  websiteUrl: text("website_url"),
  instagramUrl: text("instagram_url"),
  facebookUrl: text("facebook_url"),
  youtubeUrl: text("youtube_url"),
  tiktokUrl: text("tiktok_url"),
  linktreeUrl: text("linktree_url"),
  stripeSecretKey: text("stripe_secret_key"),
  stripePublishableKey: text("stripe_publishable_key"),
  locations: text("locations").array().default(sql`'{}'::text[]`),
  stripeCustomerId: varchar("stripe_customer_id"),
  stripeSubscriptionId: varchar("stripe_subscription_id"),
  subscriptionStatus: subscriptionStatusEnum("subscription_status").default("none"),
  trialEndsAt: timestamp("trial_ends_at"),
  subscriptionCurrentPeriodEnd: timestamp("subscription_current_period_end"),
  subscriptionsEnabled: boolean("subscriptions_enabled").default(false),
  athleticStartHour: integer("athletic_start_hour"),
  athleticEndHour: integer("athletic_end_hour"),
  coachTransactionsVisible: boolean("coach_transactions_visible").default(true),
  athleticEnabled: boolean("athletic_enabled").default(false),
  athleticProgramName: varchar("athletic_program_name").default(""),
  automationLevel: integer("automation_level").default(1),
  schedulingInquiryEmail: varchar("scheduling_inquiry_email"),
  schedulingInquiryName: varchar("scheduling_inquiry_name"),
  allowUserInquiryEmails: boolean("allow_user_inquiry_emails").default(true),
  timezone: varchar("timezone").default("America/New_York"),
  socialPreviewImageUrl: text("social_preview_image_url"),
  allowGuestBooking: boolean("allow_guest_booking").default(true),
  requireLoginToBook: boolean("require_login_to_book").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const organizationSubscriptionPlans = pgTable("organization_subscription_plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  stripeProductId: varchar("stripe_product_id").notNull(),
  stripePriceId: varchar("stripe_price_id").notNull(),
  name: varchar("name").notNull(),
  description: text("description").default(""),
  amountCents: integer("amount_cents").notNull(),
  interval: varchar("interval").notNull(),
  intervalCount: integer("interval_count").default(1),
  cancellationPolicy: varchar("cancellation_policy").default("end_of_period"),
  coachPayPerSessionCents: integer("coach_pay_per_session_cents"),
  sessionsPerWeek: integer("sessions_per_week").default(1),
  sessionType: varchar("session_type").default("personal"),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertOrganizationSchema = createInsertSchema(organizations).omit({ id: true, createdAt: true });
export type Organization = typeof organizations.$inferSelect;
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;

export const insertOrganizationSubscriptionPlanSchema = createInsertSchema(organizationSubscriptionPlans).omit({ id: true, createdAt: true });
export type OrganizationSubscriptionPlan = typeof organizationSubscriptionPlans.$inferSelect;
export type InsertOrganizationSubscriptionPlan = z.infer<typeof insertOrganizationSubscriptionPlanSchema>;

export const userSubscriptions = pgTable("user_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  userId: varchar("user_id").notNull().references(() => users.id),
  planId: varchar("plan_id").notNull(),
  stripeSubscriptionId: varchar("stripe_subscription_id"),
  stripeCheckoutSessionId: varchar("stripe_checkout_session_id"),
  status: varchar("status").notNull().default("active"),
  currentPeriodStart: timestamp("current_period_start"),
  currentPeriodEnd: timestamp("current_period_end"),
  sessionsRemaining: integer("sessions_remaining"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertUserSubscriptionSchema = createInsertSchema(userSubscriptions).omit({ id: true, createdAt: true, updatedAt: true });
export type UserSubscription = typeof userSubscriptions.$inferSelect;
export type InsertUserSubscription = z.infer<typeof insertUserSubscriptionSchema>;

export const subscriptionSchedules = pgTable("subscription_schedules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  subscriptionPlanId: varchar("subscription_plan_id").notNull(),
  clientId: varchar("client_id").notNull().references(() => users.id),
  coachId: varchar("coach_id").notNull(),
  serviceId: varchar("service_id").notNull(),
  daysOfWeek: integer("days_of_week").array().notNull(),
  startTime: varchar("start_time").notNull(),
  location: varchar("location").default(""),
  notes: text("notes").default(""),
  maxParticipants: integer("max_participants"),
  groupDescription: text("group_description").default(""),
  ageRange: varchar("age_range").default(""),
  skillLevel: varchar("skill_level").default(""),
  sport: varchar("sport").default(""),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSubscriptionScheduleSchema = createInsertSchema(subscriptionSchedules).omit({ id: true, createdAt: true });
export type SubscriptionSchedule = typeof subscriptionSchedules.$inferSelect;
export type InsertSubscriptionSchedule = z.infer<typeof insertSubscriptionScheduleSchema>;

export const roleEnum = pgEnum("user_role", ["CLIENT", "COACH", "ADMIN", "STAFF"]);
export const bookingStatusEnum = pgEnum("booking_status", ["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW", "RESCHEDULED"]);
export const payoutStatusEnum = pgEnum("payout_status", ["PENDING", "SENT", "FAILED"]);
export const paymentMethodEnum = pgEnum("payment_method", ["WALLET", "VENMO", "CASH"]);

export const userProfiles = pgTable("user_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  role: roleEnum("role").notNull().default("CLIENT"),
  organizationId: varchar("organization_id"),
});

export const coachProfiles = pgTable("coach_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id).unique(),
  email: varchar("coach_email").unique(),
  passwordHash: text("password_hash"),
  bio: text("bio").default(""),
  specialties: text("specialties").array().default(sql`'{}'::text[]`),
  photoUrl: text("photo_url"),
  timezone: varchar("timezone").default("America/New_York"),
  location: text("location").default(""),
  isActive: boolean("is_active").default(true),
  payoutPercentage: integer("payout_percentage"),
  organizationId: varchar("organization_id"),
});

export const sessionTypeEnum = pgEnum("session_type", ["1_ON_1", "GROUP", "SEMI_PRIVATE", "TEAM_TRAINING", "ASSESSMENT", "RECOVERY"]);
export const serviceCategoryEnum = pgEnum("service_category", ["paid", "intro", "internal", "meeting", "membership", "package_redemption", "comp"]);
export const revenueRecognitionEnum = pgEnum("revenue_recognition", ["at_booking", "at_purchase", "none"]);
export const payoutTypeEnum = pgEnum("payout_type", ["percentage", "fixed", "hourly", "none"]);

export const services = pgTable("services", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  description: text("description").default(""),
  durationMin: integer("duration_min").notNull().default(60),
  priceCents: integer("price_cents").notNull().default(0),
  active: boolean("active").default(true),
  sessionType: sessionTypeEnum("session_type").default("1_ON_1"),
  stripeProductId: varchar("stripe_product_id"),
  stripePriceId: varchar("stripe_price_id"),
  organizationId: varchar("organization_id"),
  category: serviceCategoryEnum("category").default("paid"),
  countsTowardRevenue: boolean("counts_toward_revenue").default(true),
  revenueRecognition: revenueRecognitionEnum("revenue_recognition").default("at_booking"),
  payoutType: payoutTypeEnum("payout_type").default("percentage"),
  payoutValueCents: integer("payout_value_cents"),
  payoutPercent: integer("payout_percent"),
  coachPayWhenRedeemed: boolean("coach_pay_when_redeemed").default(false),
  countsTowardUtilization: boolean("counts_toward_utilization").default(true),
  blocksAvailability: boolean("blocks_availability").default(true),
  countsTowardSessionCount: boolean("counts_toward_session_count").default(true),
  requiresClient: boolean("requires_client").default(true),
  isBookableByClient: boolean("is_bookable_by_client").default(true),
  isBookableByCoach: boolean("is_bookable_by_coach").default(true),
});

export const appSettings = pgTable("app_settings", {
  key: varchar("key").primaryKey(),
  value: text("value").notNull(),
});

export const availabilityBlocks = pgTable("availability_blocks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  coachId: varchar("coach_id").notNull().references(() => coachProfiles.id),
  dayOfWeek: integer("day_of_week").notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  effectiveFrom: timestamp("effective_from"),
  effectiveTo: timestamp("effective_to"),
  timezone: varchar("timezone").default("America/New_York"),
  location: text("location").default(""),
});

export const locations = pgTable("locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  name: varchar("name").notNull(),
  description: text("description").default(""),
  address: text("address").default(""),
  capacity: integer("capacity"),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertLocationSchema = createInsertSchema(locations).omit({ id: true, createdAt: true });
export type Location = typeof locations.$inferSelect;
export type InsertLocation = z.infer<typeof insertLocationSchema>;

export const blockedTimes = pgTable("blocked_times", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  coachId: varchar("coach_id").notNull().references(() => coachProfiles.id),
  organizationId: varchar("organization_id").notNull(),
  startAt: timestamp("start_at").notNull(),
  endAt: timestamp("end_at").notNull(),
  reason: text("reason").default(""),
  isAllDay: boolean("is_all_day").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertBlockedTimeSchema = createInsertSchema(blockedTimes).omit({ id: true, createdAt: true });
export type BlockedTime = typeof blockedTimes.$inferSelect;
export type InsertBlockedTime = z.infer<typeof insertBlockedTimeSchema>;

export const bookings = pgTable("bookings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id"),
  clientId: varchar("client_id").notNull().references(() => users.id),
  coachId: varchar("coach_id").notNull().references(() => coachProfiles.id),
  serviceId: varchar("service_id").notNull().references(() => services.id),
  locationId: varchar("location_id"),
  startAt: timestamp("start_at").notNull(),
  endAt: timestamp("end_at").notNull(),
  status: bookingStatusEnum("status").notNull().default("CONFIRMED"),
  notes: text("notes").default(""),
  location: text("location").default(""),
  maxParticipants: integer("max_participants"),
  groupDescription: text("group_description").default(""),
  ageRange: text("age_range").default(""),
  skillLevel: text("skill_level").default(""),
  sport: text("sport").default(""),
  recurringGroupId: varchar("recurring_group_id"),
  paymentMethod: paymentMethodEnum("payment_method"),
  teamQuoteProgramId: varchar("team_quote_program_id"),
  subscriptionPlanId: varchar("subscription_plan_id"),
  clientReminderSentAt: timestamp("client_reminder_sent_at"),
  coachReminderSentAt: timestamp("coach_reminder_sent_at"),
  googleCalendarEventId: varchar("google_calendar_event_id"),
  sourceOutcomeId: varchar("source_outcome_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const bookingParticipants = pgTable("booking_participants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bookingId: varchar("booking_id").notNull().references(() => bookings.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  participantName: varchar("participant_name"),
  joinedAt: timestamp("joined_at").defaultNow(),
});

export const redemptions = pgTable("redemptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bookingId: varchar("booking_id").notNull().references(() => bookings.id),
  coachId: varchar("coach_id").notNull().references(() => coachProfiles.id),
  redeemedAt: timestamp("redeemed_at").defaultNow(),
  payoutStatus: payoutStatusEnum("payout_status").notNull().default("PENDING"),
  amountCents: integer("amount_cents").notNull().default(0),
});

// ── Credit Ledger: auditable trail for every session-credit movement ──────────
export const creditEventTypeEnum = pgEnum("credit_event_type", [
  "subscription_renewal",
  "redemption_debit",
  "cancellation_reversal",
  "manual_adjustment",
  "refund",
  "admin_override",
]);

export const creditLedgerEvents = pgTable("credit_ledger_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull().references(() => users.id),
  bookingId: varchar("booking_id").references(() => bookings.id),
  subscriptionId: varchar("subscription_id").references(() => userSubscriptions.id),
  organizationId: varchar("organization_id"),
  eventType: creditEventTypeEnum("event_type").notNull(),
  deltaSessions: integer("delta_sessions").notNull().default(0),
  deltaCents: integer("delta_cents").notNull().default(0),
  sessionsAfter: integer("sessions_after"),
  reason: text("reason").default(""),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCreditLedgerEventSchema = createInsertSchema(creditLedgerEvents).omit({ id: true, createdAt: true });
export type CreditLedgerEvent = typeof creditLedgerEvents.$inferSelect;
export type InsertCreditLedgerEvent = z.infer<typeof insertCreditLedgerEventSchema>;

// ── Revenue Ledger: immutable financial event log ────────────────────────────
export const revenueLedgerEventTypeEnum = pgEnum("revenue_ledger_event_type", [
  "payment_received",
  "revenue_recognized",
  "deferred_revenue_created",
  "deferred_revenue_released",
  "coach_compensation_accrued",
  "coach_compensation_paid",
  "refund_issued",
  "cancellation_reversal",
  "manual_adjustment",
]);

export const revenueLedgerEvents = pgTable("revenue_ledger_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id"),
  clientId: varchar("client_id").references(() => users.id),
  coachId: varchar("coach_id").references(() => coachProfiles.id),
  bookingId: varchar("booking_id").references(() => bookings.id),
  redemptionId: varchar("redemption_id"),
  eventType: revenueLedgerEventTypeEnum("event_type").notNull(),
  amountCents: integer("amount_cents").notNull().default(0),
  reason: text("reason").default(""),
  sourceAction: varchar("source_action"),
  createdBy: varchar("created_by"),
  idempotencyKey: varchar("idempotency_key").unique(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertRevenueLedgerEventSchema = createInsertSchema(revenueLedgerEvents).omit({ id: true, createdAt: true });
export type RevenueLedgerEvent = typeof revenueLedgerEvents.$inferSelect;
export type InsertRevenueLedgerEvent = z.infer<typeof insertRevenueLedgerEventSchema>;

// ── Financial Event Failure Queue ────────────────────────────────────────────
export const financialEventFailureStatusEnum = pgEnum("financial_event_failure_status", [
  "pending",
  "retrying",
  "resolved",
  "ignored",
  "failed",
]);

export const financialEventFailures = pgTable("financial_event_failures", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id"),
  clientId: varchar("client_id"),
  coachId: varchar("coach_id"),
  bookingId: varchar("booking_id"),
  redemptionId: varchar("redemption_id"),
  sourceType: varchar("source_type").notNull(),
  eventType: varchar("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  idempotencyKey: varchar("idempotency_key"),
  failureMessage: text("failure_message"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  status: financialEventFailureStatusEnum("status").notNull().default("pending"),
  lastAttemptAt: timestamp("last_attempt_at"),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: varchar("resolved_by"),
  ignoreReason: text("ignore_reason"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertFinancialEventFailureSchema = createInsertSchema(financialEventFailures).omit({ id: true, createdAt: true, updatedAt: true });
export type FinancialEventFailure = typeof financialEventFailures.$inferSelect;
export type InsertFinancialEventFailure = z.infer<typeof insertFinancialEventFailureSchema>;

// ── Financial Closeouts ───────────────────────────────────────────────────────
export const closeoutStatusEnum = pgEnum("closeout_status", ["draft", "open", "closed", "reopened"]);
export const closeoutPeriodTypeEnum = pgEnum("closeout_period_type", ["weekly", "monthly", "custom"]);

export const financialCloseouts = pgTable("financial_closeouts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  periodType: closeoutPeriodTypeEnum("period_type").notNull().default("monthly"),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  status: closeoutStatusEnum("status").notNull().default("draft"),
  closedBy: varchar("closed_by"),
  closedAt: timestamp("closed_at"),
  reopenedBy: varchar("reopened_by"),
  reopenedAt: timestamp("reopened_at"),
  reopenReason: text("reopen_reason"),
  notes: text("notes"),
  totalsSnapshot: jsonb("totals_snapshot"),
  unresolvedIssueCount: integer("unresolved_issue_count").notNull().default(0),
  acknowledgedWarnings: boolean("acknowledged_warnings").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertFinancialCloseoutSchema = createInsertSchema(financialCloseouts).omit({ id: true, createdAt: true, updatedAt: true });
export type FinancialCloseout = typeof financialCloseouts.$inferSelect;
export type InsertFinancialCloseout = z.infer<typeof insertFinancialCloseoutSchema>;

export const closeoutAuditEvents = pgTable("closeout_audit_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  closeoutId: varchar("closeout_id").notNull(),
  actor: varchar("actor").notNull(),
  action: varchar("action").notNull(),
  previousStatus: varchar("previous_status"),
  newStatus: varchar("new_status"),
  reason: text("reason"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCloseoutAuditEventSchema = createInsertSchema(closeoutAuditEvents).omit({ id: true, createdAt: true });
export type CloseoutAuditEvent = typeof closeoutAuditEvents.$inferSelect;
export type InsertCloseoutAuditEvent = z.infer<typeof insertCloseoutAuditEventSchema>;

export const athleticPrograms = pgTable("athletic_programs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  name: varchar("name").notNull(),
  slug: varchar("slug").notNull(),
  type: varchar("type").notNull().default("scheduling"),
  maxTeamsPerSlot: integer("max_teams_per_slot").notNull().default(2),
  trainingTypes: text("training_types").array().default(sql`'{"Strength","Speed"}'::text[]`),
  startHour: integer("start_hour").notNull().default(16),
  endHour: integer("end_hour").notNull().default(20),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAthleticProgramSchema = createInsertSchema(athleticPrograms).omit({ id: true, createdAt: true });
export type AthleticProgram = typeof athleticPrograms.$inferSelect;
export type InsertAthleticProgram = z.infer<typeof insertAthleticProgramSchema>;

export const athleticHourSchedules = pgTable("athletic_hour_schedules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  programId: varchar("program_id").notNull(),
  label: varchar("label").notNull(),
  startDate: varchar("start_date").notNull(),
  endDate: varchar("end_date").notNull(),
  startHour: integer("start_hour").notNull(),
  endHour: integer("end_hour").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAthleticHourScheduleSchema = createInsertSchema(athleticHourSchedules).omit({ id: true, createdAt: true });
export type AthleticHourSchedule = typeof athleticHourSchedules.$inferSelect;
export type InsertAthleticHourSchedule = z.infer<typeof insertAthleticHourScheduleSchema>;

export const athleticBookings = pgTable("athletic_bookings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  programId: varchar("program_id").notNull(),
  date: varchar("date").notNull(),
  timeSlot: varchar("time_slot").notNull(),
  teamName: varchar("team_name").notNull(),
  trainingType: varchar("training_type").notNull().default("strength"),
  bookedBy: varchar("booked_by"),
  orgUserId: varchar("org_user_id"),
  bookerEmail: varchar("booker_email"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const walletTxTypeEnum = pgEnum("wallet_tx_type", ["CREDIT", "DEBIT"]);

export const walletTransactions = pgTable("wallet_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  type: walletTxTypeEnum("type").notNull(),
  amountCents: integer("amount_cents").notNull(),
  description: text("description").default(""),
  sourceType: varchar("source_type"),
  sourceId: varchar("source_id"),
  stripeSessionId: varchar("stripe_session_id"),
  stripePaymentIntentId: varchar("stripe_payment_intent_id"),
  stripeChargeId: varchar("stripe_charge_id"),
  currency: varchar("currency").default("usd"),
  paymentStatus: varchar("payment_status"),
  livemode: boolean("livemode").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const cashoutStatusEnum = pgEnum("cashout_status", ["REQUESTED", "PAID", "DENIED"]);

export const cashouts = pgTable("cashouts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  coachId: varchar("coach_id").notNull().references(() => coachProfiles.id),
  amountCents: integer("amount_cents").notNull(),
  status: cashoutStatusEnum("status").notNull().default("REQUESTED"),
  requestedAt: timestamp("requested_at").defaultNow(),
  processedAt: timestamp("processed_at"),
});

export const quoteStatusEnum = pgEnum("quote_status", ["DRAFT", "SENT", "PAID", "EXPIRED"]);
export const trainingTypeEnum = pgEnum("training_type_enum", ["STRENGTH", "SPEED"]);

export const teamQuotes = pgTable("team_quotes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  teamName: varchar("team_name").notNull(),
  numberOfAthletes: integer("number_of_athletes").notNull(),
  costPerAthleteCents: integer("cost_per_athlete_cents").notNull(),
  trainingType: trainingTypeEnum("training_type").notNull(),
  frequency: varchar("frequency").notNull(),
  durationWeeks: integer("duration_weeks").notNull(),
  coachEmail: varchar("coach_email").notNull(),
  totalCents: integer("total_cents").notNull(),
  status: quoteStatusEnum("status").notNull().default("DRAFT"),
  stripeInvoiceId: varchar("stripe_invoice_id"),
  stripeInvoiceUrl: varchar("stripe_invoice_url"),
  createdByCoachId: varchar("created_by_coach_id").notNull(),
  programId: varchar("program_id").default(sql`gen_random_uuid()`),
  currentMonth: integer("current_month").notNull().default(1),
  totalMonths: integer("total_months").notNull().default(1),
  organizationId: varchar("organization_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type AppSetting = typeof appSettings.$inferSelect;

export const insertAthleticBookingSchema = createInsertSchema(athleticBookings).omit({ id: true, createdAt: true });
export type AthleticBooking = typeof athleticBookings.$inferSelect;
export type InsertAthleticBooking = z.infer<typeof insertAthleticBookingSchema>;

export const insertTeamQuoteSchema = createInsertSchema(teamQuotes).omit({ id: true, createdAt: true });
export type TeamQuote = typeof teamQuotes.$inferSelect;
export type InsertTeamQuote = z.infer<typeof insertTeamQuoteSchema>;

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  user: one(users, { fields: [userProfiles.userId], references: [users.id] }),
}));

export const coachProfilesRelations = relations(coachProfiles, ({ one, many }) => ({
  user: one(users, { fields: [coachProfiles.userId], references: [users.id] }),
  availabilityBlocks: many(availabilityBlocks),
  bookings: many(bookings),
}));

export const availabilityBlocksRelations = relations(availabilityBlocks, ({ one }) => ({
  coach: one(coachProfiles, { fields: [availabilityBlocks.coachId], references: [coachProfiles.id] }),
}));

export const bookingsRelations = relations(bookings, ({ one, many }) => ({
  client: one(users, { fields: [bookings.clientId], references: [users.id] }),
  coach: one(coachProfiles, { fields: [bookings.coachId], references: [coachProfiles.id] }),
  service: one(services, { fields: [bookings.serviceId], references: [services.id] }),
  participants: many(bookingParticipants),
}));

export const bookingParticipantsRelations = relations(bookingParticipants, ({ one }) => ({
  booking: one(bookings, { fields: [bookingParticipants.bookingId], references: [bookings.id] }),
  user: one(users, { fields: [bookingParticipants.userId], references: [users.id] }),
}));

export const redemptionsRelations = relations(redemptions, ({ one }) => ({
  booking: one(bookings, { fields: [redemptions.bookingId], references: [bookings.id] }),
  coach: one(coachProfiles, { fields: [redemptions.coachId], references: [coachProfiles.id] }),
}));

export const cashoutsRelations = relations(cashouts, ({ one }) => ({
  coach: one(coachProfiles, { fields: [cashouts.coachId], references: [coachProfiles.id] }),
}));

export const walletTransactionsRelations = relations(walletTransactions, ({ one }) => ({
  user: one(users, { fields: [walletTransactions.userId], references: [users.id] }),
}));

export const waitlist = pgTable("waitlist", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  clientId: varchar("client_id").notNull().references(() => users.id),
  coachId: varchar("coach_id"),
  sessionType: varchar("session_type"),
  preferredDays: integer("preferred_days").array(),
  preferredTimeStart: varchar("preferred_time_start"),
  preferredTimeEnd: varchar("preferred_time_end"),
  notes: text("notes").default(""),
  createdAt: timestamp("created_at").defaultNow(),
});

export const agentActionLog = pgTable("agent_action_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  actionType: varchar("action_type").notNull(),
  description: text("description").notNull(),
  payload: jsonb("payload"),
  executedAt: timestamp("executed_at").defaultNow(),
  undone: boolean("undone").default(false),
});

export const agentActionStatusEnum = pgEnum("agent_action_status", ["pending", "sent", "responded", "booked", "ignored", "failed"]);

export const agentActions = pgTable("agent_actions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  clientId: varchar("client_id"),
  coachId: varchar("coach_id"),
  actionType: varchar("action_type").notNull(),
  actionSubType: varchar("action_sub_type"),
  createdAt: timestamp("created_at").defaultNow(),
  relatedSlot: jsonb("related_slot"),
  messageContent: jsonb("message_content"),
  status: agentActionStatusEnum("status").default("pending"),
  bookingId: varchar("booking_id"),
  outcomeValueCents: integer("outcome_value_cents"),
  followUpAt: timestamp("follow_up_at"),
  followUpCount: integer("follow_up_count").default(0),
  clientName: varchar("client_name"),
  notes: text("notes"),
  autoSent: boolean("auto_sent").default(false),
  autoReason: text("auto_reason"),
  variationType: varchar("variation_type"),
  scheduledFor: timestamp("scheduled_for"),
  campaignId: varchar("campaign_id"),
  campaignStep: integer("campaign_step"),
});

export const campaignStatusEnum = pgEnum("campaign_status", ["active", "paused", "completed", "stopped"]);

export const campaigns = pgTable("campaigns", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  clientId: varchar("client_id").notNull(),
  clientName: varchar("client_name"),
  coachId: varchar("coach_id"),
  campaignType: varchar("campaign_type").notNull(),
  status: campaignStatusEnum("status").default("active"),
  currentStep: integer("current_step").default(1),
  totalSteps: integer("total_steps").notNull(),
  nextActionAt: timestamp("next_action_at"),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  stoppedReason: text("stopped_reason"),
  revenueAttributedCents: integer("revenue_attributed_cents"),
  relatedSlot: jsonb("related_slot"),
  metadata: jsonb("metadata"),
});

export const mediaSectionEnum = pgEnum("media_section", ["hero", "training_showcase", "facility", "coaches", "testimonials", "results"]);
export const mediaTypeEnum = pgEnum("media_type", ["image", "video"]);

export const organizationMedia = pgTable("organization_media", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  mediaType: mediaTypeEnum("media_type").notNull().default("image"),
  section: mediaSectionEnum("section").notNull().default("hero"),
  url: text("url").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  caption: text("caption"),
  altText: text("alt_text"),
  orderIndex: integer("order_index").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  focalPoint: varchar("focal_point").default("center"),
  uploadedBy: varchar("uploaded_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertOrganizationMediaSchema = createInsertSchema(organizationMedia).omit({ id: true, createdAt: true, updatedAt: true });
export type OrganizationMedia = typeof organizationMedia.$inferSelect;
export type InsertOrganizationMedia = z.infer<typeof insertOrganizationMediaSchema>;

export const insertWaitlistSchema = createInsertSchema(waitlist).omit({ id: true, createdAt: true });
export const insertAgentActionLogSchema = createInsertSchema(agentActionLog).omit({ id: true, executedAt: true });
export const insertAgentActionSchema = createInsertSchema(agentActions).omit({ id: true, createdAt: true });
export const insertCampaignSchema = createInsertSchema(campaigns).omit({ id: true, startedAt: true });

export type Waitlist = typeof waitlist.$inferSelect;
export type InsertWaitlist = z.infer<typeof insertWaitlistSchema>;
export type AgentActionLog = typeof agentActionLog.$inferSelect;
export type InsertAgentActionLog = z.infer<typeof insertAgentActionLogSchema>;
export type AgentAction = typeof agentActions.$inferSelect;
export type InsertAgentAction = z.infer<typeof insertAgentActionSchema>;
export type Campaign = typeof campaigns.$inferSelect;
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;

export const insertUserProfileSchema = createInsertSchema(userProfiles).omit({ id: true });
export const insertCoachProfileSchema = createInsertSchema(coachProfiles).omit({ id: true });
export const insertServiceSchema = createInsertSchema(services).omit({ id: true });
export const insertAvailabilityBlockSchema = createInsertSchema(availabilityBlocks).omit({ id: true });
export const insertBookingSchema = createInsertSchema(bookings).omit({ id: true, createdAt: true });
export const insertBookingParticipantSchema = createInsertSchema(bookingParticipants).omit({ id: true, joinedAt: true });
export const insertRedemptionSchema = createInsertSchema(redemptions).omit({ id: true, redeemedAt: true });
export const insertCashoutSchema = createInsertSchema(cashouts).omit({ id: true, requestedAt: true, processedAt: true });
export const insertWalletTransactionSchema = createInsertSchema(walletTransactions).omit({ id: true, createdAt: true });

export type UserProfile = typeof userProfiles.$inferSelect;
export type InsertUserProfile = z.infer<typeof insertUserProfileSchema>;
export type CoachProfile = typeof coachProfiles.$inferSelect;
export type InsertCoachProfile = z.infer<typeof insertCoachProfileSchema>;
export type Service = typeof services.$inferSelect;
export type InsertService = z.infer<typeof insertServiceSchema>;
export type AvailabilityBlock = typeof availabilityBlocks.$inferSelect;
export type InsertAvailabilityBlock = z.infer<typeof insertAvailabilityBlockSchema>;
export type Booking = typeof bookings.$inferSelect;
export type InsertBooking = z.infer<typeof insertBookingSchema>;
export type BookingParticipant = typeof bookingParticipants.$inferSelect;
export type InsertBookingParticipant = z.infer<typeof insertBookingParticipantSchema>;
export type Redemption = typeof redemptions.$inferSelect;
export type InsertRedemption = z.infer<typeof insertRedemptionSchema>;
export type Cashout = typeof cashouts.$inferSelect;
export type InsertCashout = z.infer<typeof insertCashoutSchema>;
export type WalletTransaction = typeof walletTransactions.$inferSelect;
export type InsertWalletTransaction = z.infer<typeof insertWalletTransactionSchema>;

export const communicationLogs = pgTable("communication_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  userId: varchar("user_id"),
  coachId: varchar("coach_id"),
  bookingId: varchar("booking_id"),
  agentActionId: varchar("agent_action_id"),
  type: varchar("type").notNull(),
  channel: varchar("channel").notNull().default("email"),
  recipientEmail: varchar("recipient_email"),
  recipientPhone: varchar("recipient_phone"),
  subject: text("subject"),
  messageBody: text("message_body"),
  status: varchar("status").notNull().default("sent"),
  provider: varchar("provider").notNull().default("sendgrid"),
  sentAt: timestamp("sent_at").defaultNow(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCommunicationLogSchema = createInsertSchema(communicationLogs).omit({ id: true, createdAt: true, sentAt: true });
export type CommunicationLog = typeof communicationLogs.$inferSelect;
export type InsertCommunicationLog = z.infer<typeof insertCommunicationLogSchema>;

// ─── Team Training Prospecting ─────────────────────────────────────────────
export const prospectOutreachStatusEnum = pgEnum("prospect_outreach_status", [
  "New",
  "Needs Review",
  "Approved",
  "Contacted",
  "Replied",
  "Not Interested",
  "Do Not Contact",
]);

export const teamTrainingProspects = pgTable("team_training_prospects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  pipelineType: varchar("pipeline_type").default("b2b"),
  leadType: varchar("lead_type").default("team_partnership"),
  prospectName: varchar("prospect_name").notNull(),
  organizationType: varchar("organization_type").default("unknown"),
  sport: varchar("sport").default("unknown"),
  city: varchar("city").default("unknown"),
  state: varchar("state").default("unknown"),
  websiteUrl: text("website_url"),
  contactName: varchar("contact_name").default("unknown"),
  contactRole: varchar("contact_role").default("unknown"),
  contactEmail: varchar("contact_email"),
  contactPhone: varchar("contact_phone"),
  sourceUrl: text("source_url"),
  confidenceScore: integer("confidence_score").default(50),
  estimatedValue: integer("estimated_value"),
  outreachStatus: prospectOutreachStatusEnum("outreach_status").default("New"),
  lastContactedAt: timestamp("last_contacted_at"),
  queuedForTodayAt: timestamp("queued_for_today_at"),
  notes: text("notes").default(""),
  // Decision-maker contact fields
  decisionMakerName: varchar("decision_maker_name"),
  decisionMakerTitle: varchar("decision_maker_title"),
  decisionMakerEmail: varchar("decision_maker_email"),
  contactConfidence: integer("contact_confidence").default(0),
  contactSourceUrl: text("contact_source_url"),
  contactQuality: varchar("contact_quality").default("missing"),
  // Enrichment pipeline fields
  contactSourceType: varchar("contact_source_type").default("unverified"),
  verificationStatus: varchar("verification_status").default("unverified"),
  enrichmentExplanation: text("enrichment_explanation"),
  alternativeContacts: text("alternative_contacts"),
  // Contact Evidence Layer
  contactSourceTitle: text("contact_source_title"),
  contactSourceSnippet: text("contact_source_snippet"),
  contactDiscoveredAt: timestamp("contact_discovered_at"),
  contactDiscoveryMethod: varchar("contact_discovery_method"),
  contactConfidenceScore: doublePrecision("contact_confidence_score"),
  lastDiscoveryAttemptAt: timestamp("last_discovery_attempt_at"),
  lastDiscoveryResult: varchar("last_discovery_result"),
  // Lead Discovery Evidence Layer
  discoverySourceType: varchar("discovery_source_type"),
  discoverySourceUrl: text("discovery_source_url"),
  discoverySourceTitle: text("discovery_source_title"),
  discoverySourceSnippet: text("discovery_source_snippet"),
  discoveryQuery: text("discovery_query"),
  discoveryMethod: varchar("discovery_method"),
  discoveryConfidenceScore: doublePrecision("discovery_confidence_score"),
  discoveredAt: timestamp("discovered_at"),
  lastValidatedAt: timestamp("last_validated_at"),
  leadValidationStatus: varchar("lead_validation_status").default("likely_valid"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const teamTrainingDiscoveryLog = pgTable("team_training_discovery_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  prospectId: varchar("prospect_id"),
  prospectName: varchar("prospect_name"),
  attemptedAt: timestamp("attempted_at").defaultNow(),
  query: text("query"),
  sourceUrl: text("source_url"),
  confidence: doublePrecision("confidence"),
  result: varchar("result"),
  action: varchar("action"),
  notes: text("notes"),
});

export type TeamTrainingDiscoveryLog = typeof teamTrainingDiscoveryLog.$inferSelect;
export type InsertTeamTrainingDiscoveryLog = typeof teamTrainingDiscoveryLog.$inferInsert;

export const emailMessageVariants = pgTable("email_message_variants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  name: varchar("name").notNull(),
  subjectTemplate: text("subject_template").notNull(),
  bodyTemplate: text("body_template").notNull(),
  performanceScore: integer("performance_score").default(50),
  timesUsed: integer("times_used").default(0),
  replies: integer("replies").default(0),
  conversions: integer("conversions").default(0),
  weight: integer("weight").default(34),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertEmailMessageVariantSchema = createInsertSchema(emailMessageVariants).omit({ id: true, createdAt: true, updatedAt: true });
export type EmailMessageVariant = typeof emailMessageVariants.$inferSelect;
export type InsertEmailMessageVariant = z.infer<typeof insertEmailMessageVariantSchema>;

export const replyClassificationEnum = pgEnum("reply_classification", [
  "interested",
  "not_interested",
  "ask_info",
  "referral",
  "wrong_contact",
  "out_of_office",
  "unknown",
]);

export const teamTrainingOutreachDrafts = pgTable("team_training_outreach_drafts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  prospectId: varchar("prospect_id").notNull(),
  dealId: varchar("deal_id"),
  channel: varchar("channel").default("email"),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  outreachTone: varchar("outreach_tone"),
  aiStrategyTag: varchar("ai_strategy_tag"),
  ctaType: varchar("cta_type"),
  responseReceived: boolean("response_received").default(false),
  meetingBooked: boolean("meeting_booked").default(false),
  approved: boolean("approved").default(false),
  approvedAt: timestamp("approved_at"),
  sentAt: timestamp("sent_at"),
  openedAt: timestamp("opened_at"),
  clickedAt: timestamp("clicked_at"),
  repliedAt: timestamp("replied_at"),
  bounceType: varchar("bounce_type"),
  messageVariantId: varchar("message_variant_id"),
  replyText: text("reply_text"),
  replyClassification: replyClassificationEnum("reply_classification"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const followUpStatusEnum = pgEnum("follow_up_status", [
  "pending",
  "sent",
  "cancelled",
  "skipped",
]);

export const emailFollowUps = pgTable("email_follow_ups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  outreachDraftId: varchar("outreach_draft_id").notNull(),
  prospectId: varchar("prospect_id").notNull(),
  stepNumber: integer("step_number").notNull().default(1),
  scheduledFor: timestamp("scheduled_for").notNull(),
  sentAt: timestamp("sent_at"),
  status: followUpStatusEnum("status").default("pending"),
  subject: text("subject"),
  body: text("body"),
  messageVariantId: varchar("message_variant_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const teamTrainingOutreachEventTypeEnum = pgEnum("team_outreach_event_type", [
  "draft_created",
  "approved",
  "sent",
  "failed",
  "replied",
  "bounced",
  "unsubscribed",
  "marked_do_not_contact",
  "research_run",
  "skipped",
  "settings_updated",
  "manual_research_started",
  "manual_research_completed",
  "recurring_research_started",
  "recurring_research_completed",
  "recurring_research_failed",
  "contact_enriched",
]);

export const teamTrainingOutreachEvents = pgTable("team_training_outreach_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  prospectId: varchar("prospect_id"),
  draftId: varchar("draft_id"),
  eventType: teamTrainingOutreachEventTypeEnum("event_type").notNull(),
  description: text("description"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const prospectOptOuts = pgTable("prospect_opt_outs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  email: varchar("email").notNull(),
  optedOutAt: timestamp("opted_out_at").defaultNow(),
  reason: text("reason"),
});

// ─── Team Training Lead Research Settings ─────────────────────────────────
export const teamTrainingLeadSettings = pgTable("team_training_lead_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  defaultLocation: text("default_location").default(""),
  radiusMiles: integer("radius_miles").default(25),
  recurringEnabled: boolean("recurring_enabled").default(false),
  recurringFrequency: varchar("recurring_frequency").default("weekly"),
  recurringDayOfWeek: integer("recurring_day_of_week"),
  recurringTime: varchar("recurring_time").default("08:00"),
  recurringLimit: integer("recurring_limit").default(8),
  recurringSport: varchar("recurring_sport").default("all"),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  lastSearchCategoryIndex: integer("last_search_category_index").default(0),
  lastSearchLocationIndex: integer("last_search_location_index").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  orgUnique: uniqueIndex("team_lead_settings_org_unique").on(t.organizationId),
}));

export const insertTeamTrainingLeadSettingsSchema = createInsertSchema(teamTrainingLeadSettings).omit({ id: true, createdAt: true, updatedAt: true });
export type TeamTrainingLeadSettings = typeof teamTrainingLeadSettings.$inferSelect;
export type InsertTeamTrainingLeadSettings = z.infer<typeof insertTeamTrainingLeadSettingsSchema>;

export const insertTeamTrainingProspectSchema = createInsertSchema(teamTrainingProspects).omit({ id: true, createdAt: true, updatedAt: true });
export type TeamTrainingProspect = typeof teamTrainingProspects.$inferSelect;
export type InsertTeamTrainingProspect = z.infer<typeof insertTeamTrainingProspectSchema>;

export const insertTeamTrainingOutreachDraftSchema = createInsertSchema(teamTrainingOutreachDrafts).omit({ id: true, createdAt: true, updatedAt: true });
export type TeamTrainingOutreachDraft = typeof teamTrainingOutreachDrafts.$inferSelect;
export type InsertTeamTrainingOutreachDraft = z.infer<typeof insertTeamTrainingOutreachDraftSchema>;

export const insertEmailFollowUpSchema = createInsertSchema(emailFollowUps).omit({ id: true, createdAt: true, updatedAt: true });
export type EmailFollowUp = typeof emailFollowUps.$inferSelect;
export type InsertEmailFollowUp = z.infer<typeof insertEmailFollowUpSchema>;

export const insertTeamTrainingOutreachEventSchema = createInsertSchema(teamTrainingOutreachEvents).omit({ id: true, createdAt: true });
export type TeamTrainingOutreachEvent = typeof teamTrainingOutreachEvents.$inferSelect;
export type InsertTeamTrainingOutreachEvent = z.infer<typeof insertTeamTrainingOutreachEventSchema>;

export const insertProspectOptOutSchema = createInsertSchema(prospectOptOuts).omit({ id: true, optedOutAt: true });
export type ProspectOptOut = typeof prospectOptOuts.$inferSelect;
export type InsertProspectOptOut = z.infer<typeof insertProspectOptOutSchema>;

// ─── Per-Organization User Notification Preferences ────────────────────────
export const userOrgPreferences = pgTable("user_org_preferences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  orgId: varchar("org_id").notNull(),
  smsOptIn: boolean("sms_opt_in").notNull().default(false),
  smsOptInAt: timestamp("sms_opt_in_at"),
  smsOptOutAt: timestamp("sms_opt_out_at"),
  notificationPreferences: jsonb("notification_preferences"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  userOrgUnique: uniqueIndex("user_org_prefs_unique").on(t.userId, t.orgId),
}));

export const insertUserOrgPreferencesSchema = createInsertSchema(userOrgPreferences).omit({ id: true, createdAt: true, updatedAt: true });
export type UserOrgPreferences = typeof userOrgPreferences.$inferSelect;
export type InsertUserOrgPreferences = z.infer<typeof insertUserOrgPreferencesSchema>;

// ─── Team Training Deals ─────────────────────────────────────────────────────
export const dealStatusEnum = pgEnum("deal_status", [
  "new",
  "contacted",
  "interested",
  "call_scheduled",
  "proposal_sent",
  "negotiating",
  "won",
  "lost",
]);

export const teamTrainingDeals = pgTable("team_training_deals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  prospectId: varchar("prospect_id").notNull(),
  outreachDraftId: varchar("outreach_draft_id"),
  status: dealStatusEnum("status").default("new").notNull(),
  estimatedValue: integer("estimated_value").default(0).notNull(),
  finalValue: integer("final_value"),
  probability: integer("probability").default(40).notNull(),
  lastActivityAt: timestamp("last_activity_at").defaultNow().notNull(),
  lastContactAt: timestamp("last_contact_at"),
  nextFollowUpAt: timestamp("next_follow_up_at"),
  nextAction: text("next_action").default("").notNull(),
  notes: text("notes").default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertTeamTrainingDealSchema = createInsertSchema(teamTrainingDeals).omit({ id: true, createdAt: true, updatedAt: true });
export type TeamTrainingDeal = typeof teamTrainingDeals.$inferSelect;
export type InsertTeamTrainingDeal = z.infer<typeof insertTeamTrainingDealSchema>;

// ─── Deal Activities (Timeline) ───────────────────────────────────────────────
export const dealActivityTypeEnum = pgEnum("deal_activity_type", [
  "deal_created",
  "status_changed",
  "note_added",
  "email_sent",
  "call_logged",
  "follow_up_scheduled",
  "follow_up_completed",
  "ai_action",
  "won",
  "lost",
  "manual",
]);

export const dealActivities = pgTable("deal_activities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  dealId: varchar("deal_id").notNull(),
  organizationId: varchar("organization_id").notNull(),
  activityType: dealActivityTypeEnum("activity_type").notNull(),
  description: text("description").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type DealActivity = typeof dealActivities.$inferSelect;
export type InsertDealActivity = typeof dealActivities.$inferInsert;

// ─── AI Revenue Events ────────────────────────────────────────────────────────
export const aiRevenueEvents = pgTable("ai_revenue_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  prospectId: varchar("prospect_id"),
  dealId: varchar("deal_id"),
  executionLogId: varchar("execution_log_id"),
  actionType: varchar("action_type").notNull(),
  actionSource: varchar("action_source").notNull().default("manual"),
  outcomeStatus: varchar("outcome_status").notNull().default("pending"),
  outcomeValue: integer("outcome_value").default(0),
  outcomeSource: varchar("outcome_source"),
  outcomeTimestamp: timestamp("outcome_timestamp"),
  timeToOutcomeHours: integer("time_to_outcome_hours"),
  prospectName: varchar("prospect_name"),
  sport: varchar("sport"),
  attributionRole: varchar("attribution_role").default("primary"),
  attributionChainId: varchar("attribution_chain_id"),
  chainPosition: integer("chain_position").default(0),
  creditedValue: integer("credited_value").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAiRevenueEventSchema = createInsertSchema(aiRevenueEvents).omit({ id: true, createdAt: true });
export type AiRevenueEvent = typeof aiRevenueEvents.$inferSelect;
export type InsertAiRevenueEvent = z.infer<typeof insertAiRevenueEventSchema>;

// ─── Deal Revenue Attributions ────────────────────────────────────────────────
export const dealRevenueAttributions = pgTable("deal_revenue_attributions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  dealId: varchar("deal_id").notNull().unique(),
  prospectId: varchar("prospect_id").notNull(),
  wonAt: timestamp("won_at").notNull().defaultNow(),
  finalValue: integer("final_value").default(0),
  daysToClose: integer("days_to_close").default(0),
  totalTouchpoints: integer("total_touchpoints").default(0),
  primaryChannel: varchar("primary_channel"),
  primaryStrategy: varchar("primary_strategy"),
  primaryTone: varchar("primary_tone"),
  attributedOutreachIds: jsonb("attributed_outreach_ids").default([]),
  outreachSequence: jsonb("outreach_sequence").default([]),
  createdAt: timestamp("created_at").defaultNow(),
});

export type DealRevenueAttribution = typeof dealRevenueAttributions.$inferSelect;
export type InsertDealRevenueAttribution = typeof dealRevenueAttributions.$inferInsert;

// ─── Email Trigger Audit Events ───────────────────────────────────────────────
export const triggerTypeEnum = pgEnum("email_trigger_type", [
  "daily_outreach",
  "follow_up_cron",
  "auto_execution",
  "manual",
  "system_event",
]);

export const triggerSourceEnum = pgEnum("email_trigger_source", [
  "cron_8_30am",
  "hourly_follow_up_cron",
  "auto_exec_hook",
  "user_click",
  "api_call",
]);

export const triggerActionTypeEnum = pgEnum("email_trigger_action_type", [
  "send_initial_email",
  "send_follow_up",
  "generate_draft",
  "send_response",
]);

export const triggerBlockReasonEnum = pgEnum("email_trigger_block_reason", [
  "DNC",
  "OPTED_OUT",
  "COOLDOWN_ACTIVE",
  "DAILY_LIMIT_REACHED",
  "AUTO_EXEC_LIMIT_REACHED",
  "LOW_CONFIDENCE",
  "HIGH_RISK",
  "MISSING_EMAIL",
  "DUPLICATE_CONTACT",
  "INVALID_STAGE",
  "DEAL_ACTIVE_BLOCK",
  "AGENT_DISABLED",
  "NO_ELIGIBLE_PROSPECTS",
]);

export const emailTriggerEvents = pgTable("email_trigger_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  prospectId: varchar("prospect_id"),
  prospectName: varchar("prospect_name"),
  outreachDraftId: varchar("outreach_draft_id"),
  followUpId: varchar("follow_up_id"),
  triggerType: triggerTypeEnum("trigger_type").notNull(),
  triggerSource: triggerSourceEnum("trigger_source").notNull(),
  actionType: triggerActionTypeEnum("action_type").notNull(),
  wasExecuted: boolean("was_executed").default(false),
  executionBlocked: boolean("execution_blocked").default(false),
  blockReason: triggerBlockReasonEnum("block_reason"),
  reasoning: text("reasoning"),
  confidenceLevel: varchar("confidence_level"),
  riskScore: integer("risk_score"),
  priorityScore: integer("priority_score"),
  missedOpportunity: boolean("missed_opportunity").default(false),
  collisionDetected: boolean("collision_detected").default(false),
  collisionDetails: text("collision_details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertEmailTriggerEventSchema = createInsertSchema(emailTriggerEvents).omit({ id: true, createdAt: true, updatedAt: true });
export type EmailTriggerEvent = typeof emailTriggerEvents.$inferSelect;
export type InsertEmailTriggerEvent = z.infer<typeof insertEmailTriggerEventSchema>;

// ─── Revenue Agent ─────────────────────────────────────────────────────────────
export const revenueAgentActions = pgTable("revenue_agent_actions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  dealId: varchar("deal_id"),
  prospectId: varchar("prospect_id"),
  actionType: varchar("action_type").notNull(),
  reason: text("reason").notNull(),
  estimatedValue: integer("estimated_value").default(0),
  confidence: integer("confidence").default(50),
  priority: integer("priority").default(50),
  status: varchar("status").notNull().default("pending"),
  acceptedAt: timestamp("accepted_at"),
  dismissedAt: timestamp("dismissed_at"),
  executedAt: timestamp("executed_at"),
  outcomeType: varchar("outcome_type"),
  outcomeValue: integer("outcome_value").default(0),
  outcomeLoggedAt: timestamp("outcome_logged_at"),
  metadata: jsonb("metadata").default({}),
  agentRunId: varchar("agent_run_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type RevenueAgentAction = typeof revenueAgentActions.$inferSelect;
export type InsertRevenueAgentAction = typeof revenueAgentActions.$inferInsert;

export const revenueAgentSettings = pgTable("revenue_agent_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull().unique(),
  autoSaveDrafts: boolean("auto_save_drafts").default(false),
  autoScheduleFollowUp: boolean("auto_schedule_follow_up").default(false),
  autoLabelStale: boolean("auto_label_stale").default(false),
  dailyRunEnabled: boolean("daily_run_enabled").default(true),
  dailyRunHour: integer("daily_run_hour").default(8),
  lastRunAt: timestamp("last_run_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type RevenueAgentSettings = typeof revenueAgentSettings.$inferSelect;
export type InsertRevenueAgentSettings = typeof revenueAgentSettings.$inferInsert;

export const revenueAgentRuns = pgTable("revenue_agent_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  triggeredBy: varchar("triggered_by").notNull().default("manual"),
  actionsCreated: integer("actions_created").default(0),
  draftsSaved: integer("drafts_saved").default(0),
  followUpsScheduled: integer("follow_ups_scheduled").default(0),
  staleLabeled: integer("stale_labeled").default(0),
  status: varchar("status").notNull().default("running"),
  completedAt: timestamp("completed_at"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type RevenueAgentRun = typeof revenueAgentRuns.$inferSelect;
export type InsertRevenueAgentRun = typeof revenueAgentRuns.$inferInsert;

// ─── Multi-Agent Business Brain ───────────────────────────────────────────────

export const agentSignals = pgTable("agent_signals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  agentType: varchar("agent_type").notNull(),
  signalType: varchar("signal_type").notNull(),
  entityType: varchar("entity_type"),
  entityId: varchar("entity_id"),
  title: text("title").notNull(),
  description: text("description").notNull(),
  severity: varchar("severity").notNull().default("medium"),
  score: integer("score").default(50),
  metadata: jsonb("metadata").default({}),
  orchestratorRunId: varchar("orchestrator_run_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const agentRecommendations = pgTable("agent_recommendations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  agentType: varchar("agent_type").notNull(),
  crossAgentTypes: text("cross_agent_types").array().default([]),
  title: text("title").notNull(),
  description: text("description").notNull(),
  reason: text("reason").notNull(),
  entityType: varchar("entity_type"),
  entityId: varchar("entity_id"),
  entityName: varchar("entity_name"),
  severity: varchar("severity").notNull().default("medium"),
  estimatedImpact: integer("estimated_impact").default(0),
  priorityScore: integer("priority_score").default(50),
  status: varchar("status").notNull().default("pending"),
  actionType: varchar("action_type"),
  executedAt: timestamp("executed_at"),
  dismissedAt: timestamp("dismissed_at"),
  outcomeType: varchar("outcome_type"),
  outcomeValue: integer("outcome_value").default(0),
  outcomeLoggedAt: timestamp("outcome_logged_at"),
  metadata: jsonb("metadata").default({}),
  orchestratorRunId: varchar("orchestrator_run_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const executiveBriefs = pgTable("executive_briefs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  biggestOpportunity: jsonb("biggest_opportunity").default({}),
  highestChurnRisk: jsonb("highest_churn_risk").default({}),
  schedulingInefficiency: jsonb("scheduling_inefficiency").default({}),
  mostValuableLead: jsonb("most_valuable_lead").default({}),
  projectedWeeklyRevenue: integer("projected_weekly_revenue").default(0),
  healthScore: integer("health_score").default(50),
  recommendedActions: jsonb("recommended_actions").default([]),
  agentSummary: jsonb("agent_summary").default({}),
  rawSignals: jsonb("raw_signals").default([]),
  createdAt: timestamp("created_at").defaultNow(),
});

export const orchestratorRuns = pgTable("orchestrator_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  triggeredBy: varchar("triggered_by").notNull().default("manual"),
  agentsRun: text("agents_run").array().default([]),
  signalsCreated: integer("signals_created").default(0),
  recommendationsCreated: integer("recommendations_created").default(0),
  status: varchar("status").notNull().default("running"),
  completedAt: timestamp("completed_at"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const agentToolCalls = pgTable("agent_tool_calls", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  agentName: varchar("agent_name").notNull(),
  toolName: varchar("tool_name").notNull(),
  targetType: varchar("target_type"),
  targetId: varchar("target_id"),
  targetName: varchar("target_name"),
  inputSummary: text("input_summary"),
  proposedInput: jsonb("proposed_input").default({}),
  reason: text("reason"),
  confidence: doublePrecision("confidence"),
  estimatedImpact: integer("estimated_impact"),
  requiresConfirmation: boolean("requires_confirmation").default(false),
  confirmationStatus: varchar("confirmation_status").default("auto"),
  confirmedAt: timestamp("confirmed_at"),
  confirmedBy: varchar("confirmed_by"),
  status: varchar("status").default("pending"),
  result: jsonb("result").default({}),
  error: text("error"),
  executionTimeMs: integer("execution_time_ms"),
  sourceRecommendationId: varchar("source_recommendation_id"),
  sourceRevenueActionId: varchar("source_revenue_action_id"),
  createdAt: timestamp("created_at").defaultNow(),
  executedAt: timestamp("executed_at"),
  idempotencyKey: varchar("idempotency_key"),
  providerMessageId: varchar("provider_message_id"),
  sendAttempts: integer("send_attempts").default(0).notNull(),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: varchar("resolved_by"),
});

export type AgentToolCall = typeof agentToolCalls.$inferSelect;
export type InsertAgentToolCall = typeof agentToolCalls.$inferInsert;

// ─── Workflow Orchestration ────────────────────────────────────────────────────

export const workflowRuns = pgTable("workflow_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: varchar("org_id").notNull(),
  // Legacy executor fields
  workflowType: varchar("workflow_type"),
  displayName: varchar("display_name"),
  currentStepIndex: integer("current_step_index").default(0),
  totalSteps: integer("total_steps").default(0),
  entityType: varchar("entity_type"),
  entityId: varchar("entity_id"),
  entityName: varchar("entity_name"),
  triggerReason: text("trigger_reason"),
  triggerSource: varchar("trigger_source"),
  sourceRecommendationId: varchar("source_recommendation_id"),
  sourceRevenueActionId: varchar("source_revenue_action_id"),
  context: jsonb("context").default({}),
  result: jsonb("result"),
  error: text("error"),
  nextCheckAt: timestamp("next_check_at"),
  lockedAt: timestamp("locked_at"),
  // Orchestrator fields
  workflowTemplateKey: varchar("workflow_template_key"),
  sourceType: varchar("source_type"),
  sourceId: varchar("source_id"),
  currentStepKey: varchar("current_step_key"),
  failedAt: timestamp("failed_at"),
  failureReason: text("failure_reason"),
  createdBy: varchar("created_by"),
  metadata: jsonb("metadata"),
  updatedAt: timestamp("updated_at").defaultNow(),
  // Shared
  status: varchar("status").default("pending").notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  cancelledAt: timestamp("cancelled_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const workflowSteps = pgTable("workflow_steps", {
  id: uuid("id").defaultRandom().primaryKey(),
  workflowRunId: uuid("workflow_run_id").notNull(),
  orgId: varchar("org_id").notNull(),
  stepIndex: integer("step_index").notNull(),
  stepName: varchar("step_name").notNull(),
  stepType: varchar("step_type").notNull(),
  status: varchar("status").default("pending").notNull(),
  input: jsonb("input"),
  output: jsonb("output"),
  error: text("error"),
  toolCallId: varchar("tool_call_id"),
  retryCount: integer("retry_count").default(0).notNull(),
  confirmationStatus: varchar("confirmation_status"),
  confirmedBy: varchar("confirmed_by"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertWorkflowRunSchema = createInsertSchema(workflowRuns).omit({ id: true, createdAt: true, updatedAt: true });
export type WorkflowRun = typeof workflowRuns.$inferSelect;
export type InsertWorkflowRun = typeof workflowRuns.$inferInsert;
export type WorkflowStep = typeof workflowSteps.$inferSelect;
export type InsertWorkflowStep = typeof workflowSteps.$inferInsert;

export const workflowSettings = pgTable("workflow_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: varchar("org_id").notNull().unique(),
  autoStartSafeWorkflows: boolean("auto_start_safe_workflows").default(false).notNull(),
  requireApprovalBeforeMessages: boolean("require_approval_before_messages").default(true).notNull(),
  neverAutoSend: boolean("never_auto_send").default(true).notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type WorkflowSettings = typeof workflowSettings.$inferSelect;
export type InsertWorkflowSettings = typeof workflowSettings.$inferInsert;

export type AgentSignal = typeof agentSignals.$inferSelect;
export type InsertAgentSignal = typeof agentSignals.$inferInsert;
export type AgentRecommendation = typeof agentRecommendations.$inferSelect;
export type InsertAgentRecommendation = typeof agentRecommendations.$inferInsert;
export type ExecutiveBrief = typeof executiveBriefs.$inferSelect;
export type InsertExecutiveBrief = typeof executiveBriefs.$inferInsert;
export type OrchestratorRun = typeof orchestratorRuns.$inferSelect;
export type InsertOrchestratorRun = typeof orchestratorRuns.$inferInsert;

// ─── Connector Tokens ─────────────────────────────────────────────────────────

export const connectorTokens = pgTable("connector_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: varchar("org_id").notNull(),
  connector: varchar("connector").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  tokenExpiry: timestamp("token_expiry"),
  scope: text("scope"),
  email: varchar("email"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type ConnectorToken = typeof connectorTokens.$inferSelect;

// ─── Agent Invoices ───────────────────────────────────────────────────────────

export const agentInvoices = pgTable("agent_invoices", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: varchar("org_id").notNull(),
  stripeInvoiceId: varchar("stripe_invoice_id"),
  stripeCustomerId: varchar("stripe_customer_id"),
  toolCallId: varchar("tool_call_id"),
  workflowRunId: varchar("workflow_run_id"),
  clientId: varchar("client_id"),
  amountCents: integer("amount_cents"),
  description: text("description"),
  status: varchar("status").default("draft"),
  dueDate: timestamp("due_date"),
  stripeInvoiceUrl: varchar("stripe_invoice_url"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type AgentInvoice = typeof agentInvoices.$inferSelect;

// ─── Unified Attention Items ──────────────────────────────────────────────────
// level:    critical | important | suggested | informational
// category: workflow | approval | payment | connector | deal | churn | growth |
//           insight  | ops      | brain    | trigger   | manual
// status:   active   | snoozed  | dismissed | completed | escalated
// score:    (severity*0.30) + (urgency*0.40) + (businessImpact*0.20) + (confidence*100*0.10)

export const attentionItems = pgTable("attention_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  level: varchar("level").notNull().default("informational"),
  category: varchar("category").notNull().default("insight"),
  title: text("title").notNull(),
  body: text("body"),
  source: varchar("source").notNull().default("manual"),
  sourceId: varchar("source_id"),
  severity: integer("severity").notNull().default(50),
  urgency: integer("urgency").notNull().default(50),
  businessImpact: integer("business_impact").notNull().default(50),
  confidence: doublePrecision("confidence").notNull().default(0.8),
  actionUrl: text("action_url"),
  actionLabel: varchar("action_label"),
  status: varchar("status").notNull().default("active"),
  snoozedUntil: timestamp("snoozed_until"),
  escalatedAt: timestamp("escalated_at"),
  expiresAt: timestamp("expires_at"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAttentionItemSchema = createInsertSchema(attentionItems).omit({ id: true, createdAt: true, updatedAt: true });
export type AttentionItem = typeof attentionItems.$inferSelect;
export type InsertAttentionItem = z.infer<typeof insertAttentionItemSchema>;

// ─── Agent Pending Actions ─────────────────────────────────────────────────────
// Persists the two-call confirmation handshake so actions survive server restarts.
// status: pending → completed (confirmed) | cancelled (dropped) | expired (TTL hit)

export const agentPendingActionStatusEnum = pgEnum("agent_pending_action_status", [
  "pending",
  "completed",
  "cancelled",
  "expired",
]);

export const agentPendingActions = pgTable("agent_pending_actions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"),
  orgId: varchar("org_id"),
  actionType: varchar("action_type").notNull(),
  normalizedArgs: jsonb("normalized_args").notNull().default(sql`'{}'::jsonb`),
  status: agentPendingActionStatusEnum("status").notNull().default("pending"),
  idempotencyKey: varchar("idempotency_key", { length: 128 }).unique(),
  providerMessageSid: varchar("provider_message_sid"),
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
  completedAt: timestamp("completed_at"),
  cancelledAt: timestamp("cancelled_at"),
});

export const insertAgentPendingActionSchema = createInsertSchema(agentPendingActions).omit({ id: true, createdAt: true });
export type AgentPendingAction = typeof agentPendingActions.$inferSelect;
export type InsertAgentPendingAction = z.infer<typeof insertAgentPendingActionSchema>;

// ─── Operator Actions ─────────────────────────────────────────────────────────
// sourceType:  financial_brain | reconciliation | integrity_check | scheduling |
//              churn_risk | payout_review | manual
// severity:    info | warning | critical
// category:    financial | payout | churn | scheduling | accounting |
//              client_retention | coach_operations
// status:      open | acknowledged | in_progress | resolved | ignored

export const operatorActions = pgTable("operator_actions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  sourceType: varchar("source_type").notNull().default("manual"),
  sourceKey: varchar("source_key"),
  severity: varchar("severity").notNull().default("info"),
  category: varchar("category").notNull().default("financial"),
  title: text("title").notNull(),
  description: text("description"),
  suggestedAction: text("suggested_action"),
  status: varchar("status").notNull().default("open"),
  assignedToUserId: varchar("assigned_to_user_id"),
  assignedToCoachId: varchar("assigned_to_coach_id"),
  relatedClientId: varchar("related_client_id"),
  relatedBookingId: varchar("related_booking_id"),
  relatedCoachId: varchar("related_coach_id"),
  relatedCloseoutId: varchar("related_closeout_id"),
  estimatedImpact: text("estimated_impact"),
  metadata: jsonb("metadata"),
  acknowledgedAt: timestamp("acknowledged_at"),
  resolvedAt: timestamp("resolved_at"),
  ignoredAt: timestamp("ignored_at"),
  ignoredReason: text("ignored_reason"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertOperatorActionSchema = createInsertSchema(operatorActions).omit({ id: true, createdAt: true, updatedAt: true });
export type OperatorAction = typeof operatorActions.$inferSelect;
export type InsertOperatorAction = z.infer<typeof insertOperatorActionSchema>;

// ─── Operator Action Events ───────────────────────────────────────────────────
// eventType: created | acknowledged | assigned | started | resolved | ignored |
//            note_added | reassigned

export const operatorActionEvents = pgTable("operator_action_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  operatorActionId: varchar("operator_action_id").notNull(),
  actorId: varchar("actor_id"),
  eventType: varchar("event_type").notNull(),
  previousStatus: varchar("previous_status"),
  newStatus: varchar("new_status"),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertOperatorActionEventSchema = createInsertSchema(operatorActionEvents).omit({ id: true, createdAt: true });
export type OperatorActionEvent = typeof operatorActionEvents.$inferSelect;
export type InsertOperatorActionEvent = z.infer<typeof insertOperatorActionEventSchema>;

// ─── Retention Workflows ──────────────────────────────────────────────────────
// workflowType: inactive_prepaid | unused_credits | expiring_package |
//               unpaid_balance | no_show_followup | stalled_client | churn_risk | manual
// status:       draft | active | contacted | awaiting_response |
//               recovered | churned | completed | cancelled | paused
// riskSeverity: info | warning | critical

export const retentionWorkflows = pgTable("retention_workflows", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  workflowType: varchar("workflow_type").notNull().default("manual"),
  status: varchar("status").notNull().default("draft"),
  relatedClientId: varchar("related_client_id"),
  relatedOperatorActionId: varchar("related_operator_action_id"),
  riskSeverity: varchar("risk_severity").notNull().default("warning"),
  estimatedRevenueAtRiskCents: integer("estimated_revenue_at_risk_cents").default(0),
  estimatedRecoverableRevenueCents: integer("estimated_recoverable_revenue_cents").default(0),
  metadata: jsonb("metadata"),
  createdBy: varchar("created_by"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  cancelledAt: timestamp("cancelled_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertRetentionWorkflowSchema = createInsertSchema(retentionWorkflows).omit({ id: true, createdAt: true, updatedAt: true });
export type RetentionWorkflow = typeof retentionWorkflows.$inferSelect;
export type InsertRetentionWorkflow = z.infer<typeof insertRetentionWorkflowSchema>;

// ─── Retention Workflow Events ────────────────────────────────────────────────
// eventType: created | activated | contacted | awaiting_response | recovered |
//            churned | completed | cancelled | paused | resumed | note_added | outreach_drafted

export const retentionWorkflowEvents = pgTable("retention_workflow_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workflowId: varchar("workflow_id").notNull(),
  actorId: varchar("actor_id"),
  eventType: varchar("event_type").notNull(),
  note: text("note"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertRetentionWorkflowEventSchema = createInsertSchema(retentionWorkflowEvents).omit({ id: true, createdAt: true });
export type RetentionWorkflowEvent = typeof retentionWorkflowEvents.$inferSelect;
export type InsertRetentionWorkflowEvent = z.infer<typeof insertRetentionWorkflowEventSchema>;

// ─── Outreach Drafts ──────────────────────────────────────────────────────────
// channel:  email | sms | in_app
// purpose:  inactive_client | unused_credits | expiring_package | unpaid_balance |
//           no_show_followup | churn_recovery | scheduling_recovery | general
// tone:     professional | supportive | energetic | accountability | relationship_first
// status:   draft | pending_approval | approved | sent | rejected | cancelled

export const outreachDrafts = pgTable("outreach_drafts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  workflowId: varchar("workflow_id"),
  operatorActionId: varchar("operator_action_id"),
  relatedClientId: varchar("related_client_id"),
  relatedCoachId: varchar("related_coach_id"),
  channel: varchar("channel").notNull().default("email"),
  purpose: varchar("purpose").notNull().default("general"),
  tone: varchar("tone").notNull().default("professional"),
  status: varchar("status").notNull().default("draft"),
  subject: varchar("subject"),
  content: text("content").notNull().default(""),
  aiGenerated: boolean("ai_generated").default(false),
  aiPromptSnapshot: text("ai_prompt_snapshot"),
  aiContextSnapshot: jsonb("ai_context_snapshot"),
  generatedBy: varchar("generated_by"),
  approvedBy: varchar("approved_by"),
  sentBy: varchar("sent_by"),
  approvedAt: timestamp("approved_at"),
  sentAt: timestamp("sent_at"),
  rejectedAt: timestamp("rejected_at"),
  rejectionReason: text("rejection_reason"),
  sendResult: jsonb("send_result"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertOutreachDraftSchema = createInsertSchema(outreachDrafts).omit({ id: true, createdAt: true, updatedAt: true });
export type OutreachDraft = typeof outreachDrafts.$inferSelect;
export type InsertOutreachDraft = z.infer<typeof insertOutreachDraftSchema>;

// ─── Outreach Events ──────────────────────────────────────────────────────────
// eventType: generated | edited | submitted_for_approval | approved | rejected |
//            sent | cancelled | note_added | regenerated

export const outreachEvents = pgTable("outreach_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  outreachDraftId: varchar("outreach_draft_id").notNull(),
  actorId: varchar("actor_id"),
  eventType: varchar("event_type").notNull(),
  previousStatus: varchar("previous_status"),
  newStatus: varchar("new_status"),
  note: text("note"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertOutreachEventSchema = createInsertSchema(outreachEvents).omit({ id: true, createdAt: true });
export type OutreachEvent = typeof outreachEvents.$inferSelect;
export type InsertOutreachEvent = z.infer<typeof insertOutreachEventSchema>;

// step status: pending | running | waiting | completed | failed | skipped

export const workflowStepRuns = pgTable("workflow_step_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workflowRunId: varchar("workflow_run_id").notNull(),
  stepKey: varchar("step_key").notNull(),
  stepType: varchar("step_type").notNull(),
  status: varchar("status").notNull().default("pending"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  failedAt: timestamp("failed_at"),
  output: jsonb("output"),
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertWorkflowStepRunSchema = createInsertSchema(workflowStepRuns).omit({ id: true, createdAt: true, updatedAt: true });
export type WorkflowStepRun = typeof workflowStepRuns.$inferSelect;
export type InsertWorkflowStepRun = z.infer<typeof insertWorkflowStepRunSchema>;

// ─── Shared Org Identity Layer ────────────────────────────────────────────────

export const orgUsers = pgTable("org_users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  email: varchar("email").notNull(),
  passwordHash: varchar("password_hash").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  lastLoginAt: timestamp("last_login_at"),
});

export const orgMemberships = pgTable("org_memberships", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  userId: varchar("user_id").notNull(),
  role: varchar("role").notNull().default("athlete"),
  status: varchar("status").notNull().default("active"),
  permissions: jsonb("permissions"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const orgSessions = pgTable("org_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  userId: varchar("user_id").notNull(),
  tokenHash: varchar("token_hash").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  keepLoggedIn: boolean("keep_logged_in").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  lastUsedAt: timestamp("last_used_at").defaultNow(),
});

// ─── PR Tracker ───────────────────────────────────────────────────────────────

export const prTeams = pgTable("pr_teams", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  programId: varchar("program_id").notNull(),
  coachUserId: varchar("coach_user_id").notNull(),
  name: varchar("name").notNull(),
  sport: varchar("sport"),
  season: varchar("season"),
  joinCode: varchar("join_code").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  archivedAt: timestamp("archived_at"),
});

export const prTeamMembers = pgTable("pr_team_members", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  teamId: varchar("team_id").notNull(),
  userId: varchar("user_id").notNull(),
  role: varchar("role").notNull().default("athlete"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const prLiftTypes = pgTable("pr_lift_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  programId: varchar("program_id").notNull(),
  name: varchar("name").notNull(),
  category: varchar("category"),
  unit: varchar("unit").notNull().default("lbs"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const prLiftEntries = pgTable("pr_lift_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  programId: varchar("program_id").notNull(),
  userId: varchar("user_id").notNull(),
  teamId: varchar("team_id"),
  liftTypeId: varchar("lift_type_id").notNull(),
  value: doublePrecision("value").notNull(),
  unit: varchar("unit").notNull().default("lbs"),
  entryDate: varchar("entry_date").notNull(),
  notes: text("notes"),
  verifiedByCoachId: varchar("verified_by_coach_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const prImportJobs = pgTable("pr_import_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  programId: varchar("program_id").notNull(),
  coachUserId: varchar("coach_user_id").notNull(),
  filename: varchar("filename"),
  status: varchar("status").notNull().default("pending"),
  rowCount: integer("row_count").default(0),
  successCount: integer("success_count").default(0),
  errorCount: integer("error_count").default(0),
  errors: jsonb("errors"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── PR Intelligence Agent ────────────────────────────────────────────────────

export const prAgentResearchJobs = pgTable("pr_agent_research_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  athleteUserId: varchar("athlete_user_id").notNull(),
  coachUserId: varchar("coach_user_id").notNull(),
  status: varchar("status").notNull().default("pending"),
  query: jsonb("query"),
  result: jsonb("result"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const athletePublicProfiles = pgTable("athlete_public_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  athleteUserId: varchar("athlete_user_id").notNull(),
  sourceName: varchar("source_name"),
  sourceUrl: text("source_url"),
  sourceTitle: text("source_title"),
  confidenceScore: doublePrecision("confidence_score").default(0),
  extractedData: jsonb("extracted_data"),
  approvedByCoachId: varchar("approved_by_coach_id"),
  approvedAt: timestamp("approved_at"),
  status: varchar("status").notNull().default("pending_review"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const athleteAiSummaries = pgTable("athlete_ai_summaries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  athleteUserId: varchar("athlete_user_id").notNull(),
  coachUserId: varchar("coach_user_id").notNull(),
  summaryType: varchar("summary_type").notNull(),
  sourceSnapshot: jsonb("source_snapshot"),
  generatedText: text("generated_text").notNull(),
  editedText: text("edited_text"),
  status: varchar("status").notNull().default("draft"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── Athlete Watchlists ───────────────────────────────────────────────────────
export const athleteWatchlists = pgTable("athlete_watchlists", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  athleteUserId: varchar("athlete_user_id").notNull(),
  coachUserId: varchar("coach_user_id").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  monitorPublicProfiles: boolean("monitor_public_profiles").notNull().default(true),
  monitorStats: boolean("monitor_stats").notNull().default(true),
  monitorMedia: boolean("monitor_media").notNull().default(true),
  monitorPrProgress: boolean("monitor_pr_progress").notNull().default(true),
  monitorAttendance: boolean("monitor_attendance").notNull().default(true),
  monitorBookingInactivity: boolean("monitor_booking_inactivity").notNull().default(false),
  monitorTrainingConsistency: boolean("monitor_training_consistency").notNull().default(true),
  frequency: varchar("frequency").notNull().default("weekly"),
  lastCheckedAt: timestamp("last_checked_at"),
  nextCheckAt: timestamp("next_check_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── Athlete Intelligence Snapshots ──────────────────────────────────────────
export const athleteIntelligenceSnapshots = pgTable("athlete_intelligence_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  athleteUserId: varchar("athlete_user_id").notNull(),
  sourceType: varchar("source_type").notNull(),
  sourceUrl: text("source_url").notNull(),
  snapshotHash: varchar("snapshot_hash").notNull(),
  snapshotData: jsonb("snapshot_data"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── Athlete Intelligence Alerts ──────────────────────────────────────────────
export const athleteIntelligenceAlerts = pgTable("athlete_intelligence_alerts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  athleteUserId: varchar("athlete_user_id").notNull(),
  coachUserId: varchar("coach_user_id").notNull(),
  alertType: varchar("alert_type").notNull(),
  severity: varchar("severity").notNull().default("info"),
  title: varchar("title").notNull(),
  summary: text("summary"),
  metadata: jsonb("metadata"),
  sourceUrl: text("source_url"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const athleteExternalAssets = pgTable("athlete_external_assets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  athleteUserId: varchar("athlete_user_id").notNull(),
  sourceType: varchar("source_type").notNull(),
  sourceUrl: text("source_url").notNull(),
  title: text("title"),
  thumbnailUrl: text("thumbnail_url"),
  extractedMetadata: jsonb("extracted_metadata"),
  confidenceScore: doublePrecision("confidence_score").default(0),
  status: varchar("status").notNull().default("pending_review"),
  approvedByCoachId: varchar("approved_by_coach_id"),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── Workout Builder Tables ───────────────────────────────────────────────────

export const workoutPrograms = pgTable("workout_programs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  programToolId: varchar("program_tool_id").notNull(),
  createdByUserId: varchar("created_by_user_id").notNull(),
  trainChatProgramId: varchar("trainchat_program_id"),
  title: varchar("title").notNull(),
  description: text("description"),
  goal: varchar("goal").notNull(),
  sport: varchar("sport"),
  durationWeeks: integer("duration_weeks").notNull(),
  daysPerWeek: integer("days_per_week").notNull(),
  status: varchar("status").notNull().default("draft"),
  source: varchar("source").notNull().default("trainchat_api"),
  trainChatRawResponse: jsonb("trainchat_raw_response"),
  generatedSummary: text("generated_summary"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const workoutProgramAssignments = pgTable("workout_program_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  workoutProgramId: varchar("workout_program_id").notNull(),
  assignedToType: varchar("assigned_to_type").notNull(),
  athleteUserId: varchar("athlete_user_id"),
  teamId: varchar("team_id"),
  assignedByUserId: varchar("assigned_by_user_id").notNull(),
  assignedAt: timestamp("assigned_at").defaultNow(),
  status: varchar("status").notNull().default("active"),
});

export const workoutSessions = pgTable("workout_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  workoutProgramId: varchar("workout_program_id").notNull(),
  weekNumber: integer("week_number").notNull(),
  dayNumber: integer("day_number").notNull(),
  title: varchar("title").notNull(),
  focus: varchar("focus"),
  sessionData: jsonb("session_data"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const workoutCompletionLogs = pgTable("workout_completion_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  workoutSessionId: varchar("workout_session_id").notNull(),
  athleteUserId: varchar("athlete_user_id").notNull(),
  completedAt: timestamp("completed_at").defaultNow(),
  notes: text("notes"),
  rating: integer("rating"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type WorkoutProgram = typeof workoutPrograms.$inferSelect;
export type WorkoutProgramAssignment = typeof workoutProgramAssignments.$inferSelect;
export type WorkoutSession = typeof workoutSessions.$inferSelect;
export type WorkoutCompletionLog = typeof workoutCompletionLogs.$inferSelect;

// ─── Workout Execution Tables ─────────────────────────────────────────────────

export const workoutReadinessCheckins = pgTable("workout_readiness_checkins", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  athleteUserId: varchar("athlete_user_id").notNull(),
  workoutSessionId: varchar("workout_session_id"),
  readinessScore: integer("readiness_score").notNull(),
  sleepQuality: integer("sleep_quality"),
  sorenessLevel: integer("soreness_level"),
  fatigueLevel: integer("fatigue_level"),
  stressLevel: integer("stress_level"),
  motivationLevel: integer("motivation_level"),
  painAreas: jsonb("pain_areas"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const workoutSessionExerciseLogs = pgTable("workout_session_exercise_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  workoutSessionId: varchar("workout_session_id").notNull(),
  athleteUserId: varchar("athlete_user_id").notNull(),
  exerciseName: varchar("exercise_name").notNull(),
  prescribedData: jsonb("prescribed_data"),
  completedData: jsonb("completed_data"),
  rpe: integer("rpe"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const workoutAdaptationRecommendations = pgTable("workout_adaptation_recommendations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  athleteUserId: varchar("athlete_user_id").notNull(),
  workoutProgramId: varchar("workout_program_id").notNull(),
  workoutSessionId: varchar("workout_session_id"),
  recommendationType: varchar("recommendation_type").notNull(),
  severity: varchar("severity").notNull().default("info"),
  reason: text("reason").notNull(),
  suggestedChange: jsonb("suggested_change"),
  source: varchar("source").notNull().default("rules"),
  status: varchar("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type WorkoutReadinessCheckin = typeof workoutReadinessCheckins.$inferSelect;
export type WorkoutSessionExerciseLog = typeof workoutSessionExerciseLogs.$inferSelect;
export type WorkoutAdaptationRecommendation = typeof workoutAdaptationRecommendations.$inferSelect;

// ─── Org Communication & Notifications ───────────────────────────────────────

export const orgMessages = pgTable("org_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  senderUserId: varchar("sender_user_id").notNull(),
  recipientUserId: varchar("recipient_user_id"),
  teamId: varchar("team_id"),
  messageType: varchar("message_type").notNull().default("direct"),
  subject: varchar("subject"),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const orgMessageReads = pgTable("org_message_reads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  messageId: varchar("message_id").notNull(),
  userId: varchar("user_id").notNull(),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const orgNotifications = pgTable("org_notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  userId: varchar("user_id").notNull(),
  type: varchar("type").notNull(),
  title: varchar("title").notNull(),
  message: text("message").notNull(),
  actionUrl: varchar("action_url"),
  metadata: jsonb("metadata"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const notificationAutomationLogs = pgTable("notification_automation_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  eventType: varchar("event_type").notNull(),
  orgId: varchar("org_id").notNull(),
  userId: varchar("user_id"),
  payload: jsonb("payload").notNull().default({}),
  notificationIds: jsonb("notification_ids").notNull().default([]),
  status: varchar("status").notNull().default("processed"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const orgActivityEvents = pgTable("org_activity_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  userId: varchar("user_id"),
  teamId: varchar("team_id"),
  sourceType: varchar("source_type").notNull(),
  sourceId: varchar("source_id"),
  eventType: varchar("event_type").notNull(),
  title: varchar("title").notNull(),
  description: text("description"),
  eventDate: timestamp("event_date").notNull().defaultNow(),
  metadata: jsonb("metadata").notNull().default({}),
  visibility: varchar("visibility").notNull().default("athlete"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type OrgActivityEvent = typeof orgActivityEvents.$inferSelect;

export const nutritionModules = pgTable("nutrition_modules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id"),
  moduleNumber: integer("module_number").notNull(),
  title: varchar("title").notNull(),
  description: text("description"),
  content: jsonb("content").notNull().default({}),
  isDefault: boolean("is_default").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const nutritionQuizQuestions = pgTable("nutrition_quiz_questions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  moduleId: varchar("module_id").notNull(),
  question: text("question").notNull(),
  options: jsonb("options").notNull().default([]),
  correctAnswer: integer("correct_answer").notNull(),
  explanation: text("explanation"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const nutritionProgress = pgTable("nutrition_progress", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  athleteUserId: varchar("athlete_user_id").notNull(),
  moduleId: varchar("module_id").notNull(),
  status: varchar("status").notNull().default("not_started"),
  quizScore: integer("quiz_score"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const nutritionQuizAttempts = pgTable("nutrition_quiz_attempts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  athleteUserId: varchar("athlete_user_id").notNull(),
  moduleId: varchar("module_id").notNull(),
  answers: jsonb("answers").notNull().default([]),
  score: integer("score").notNull(),
  passed: boolean("passed").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export type NutritionModule = typeof nutritionModules.$inferSelect;
export type NutritionQuizQuestion = typeof nutritionQuizQuestions.$inferSelect;
export type NutritionProgress = typeof nutritionProgress.$inferSelect;
export type NutritionQuizAttempt = typeof nutritionQuizAttempts.$inferSelect;

// ─── Education Builder System ─────────────────────────────────────────────────

export const educationPathways = pgTable("education_pathways", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id"),
  createdByUserId: varchar("created_by_user_id"),
  title: varchar("title").notNull(),
  slug: varchar("slug").notNull(),
  category: varchar("category").notNull().default("custom"),
  description: text("description"),
  status: varchar("status").notNull().default("draft"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const educationModules = pgTable("education_modules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id"),
  pathwayId: varchar("pathway_id").notNull(),
  moduleNumber: integer("module_number").notNull(),
  title: varchar("title").notNull(),
  description: text("description"),
  content: jsonb("content").notNull().default({}),
  keyTakeaways: jsonb("key_takeaways").notNull().default([]),
  estimatedMinutes: integer("estimated_minutes").default(10),
  videoUrl: varchar("video_url"),
  videoSearchQuery: varchar("video_search_query"),
  performanceConnection: text("performance_connection"),
  coachReinforcementNotes: jsonb("coach_reinforcement_notes").default([]),
  status: varchar("status").notNull().default("draft"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const educationQuizQuestions = pgTable("education_quiz_questions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id"),
  pathwayId: varchar("pathway_id").notNull(),
  moduleId: varchar("module_id").notNull(),
  question: text("question").notNull(),
  options: jsonb("options").notNull().default([]),
  correctAnswer: integer("correct_answer").notNull(),
  explanation: text("explanation"),
  questionType: varchar("question_type").notNull().default("module"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const educationProgress = pgTable("education_progress", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  pathwayId: varchar("pathway_id").notNull(),
  moduleId: varchar("module_id").notNull(),
  athleteUserId: varchar("athlete_user_id").notNull(),
  status: varchar("status").notNull().default("not_started"),
  quizScore: integer("quiz_score"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const educationAssignments = pgTable("education_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  pathwayId: varchar("pathway_id").notNull(),
  assignedToType: varchar("assigned_to_type").notNull(),
  athleteUserId: varchar("athlete_user_id"),
  teamId: varchar("team_id"),
  assignedByUserId: varchar("assigned_by_user_id").notNull(),
  dueDate: timestamp("due_date"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const educationAiGenerations = pgTable("education_ai_generations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  pathwayId: varchar("pathway_id"),
  moduleId: varchar("module_id"),
  coachUserId: varchar("coach_user_id").notNull(),
  generationType: varchar("generation_type").notNull(),
  prompt: text("prompt").notNull(),
  result: jsonb("result").notNull().default({}),
  status: varchar("status").notNull().default("draft"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type EducationPathway = typeof educationPathways.$inferSelect;
export type EducationModule = typeof educationModules.$inferSelect;
export type EducationQuizQuestion = typeof educationQuizQuestions.$inferSelect;
export type EducationProgress = typeof educationProgress.$inferSelect;
export type EducationAssignment = typeof educationAssignments.$inferSelect;
export type EducationAiGeneration = typeof educationAiGenerations.$inferSelect;

// ─── Education Phase 2: Adaptive Learning System ──────────────────────────────

// Rules Engine — IF trigger → THEN action
export const educationRules = pgTable("education_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  createdByUserId: varchar("created_by_user_id").notNull(),
  name: varchar("name").notNull(),
  triggerType: varchar("trigger_type").notNull(),
  // "athlete_joined" | "readiness_low" | "quiz_failed" | "pathway_completed" | "module_overdue"
  triggerConfig: jsonb("trigger_config").notNull().default({}),
  // e.g. { threshold: 3, days: 7, pathwayId: "...", score: 80 }
  actionType: varchar("action_type").notNull(),
  // "assign_pathway" | "notify_coach" | "award_badge" | "send_reminder"
  actionConfig: jsonb("action_config").notNull().default({}),
  // e.g. { pathwayId: "...", badgeId: "...", message: "..." }
  isActive: boolean("is_active").notNull().default(true),
  requiresApproval: boolean("requires_approval").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Assignment Plans — week-by-week curriculum builder
export const educationAssignmentPlans = pgTable("education_assignment_plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  createdByUserId: varchar("created_by_user_id").notNull(),
  name: varchar("name").notNull(),
  description: text("description"),
  weeks: jsonb("weeks").notNull().default([]),
  // [{ week: 1, pathwayId: "...", title: "Nutrition Foundations", notes: "..." }]
  assignedToType: varchar("assigned_to_type").notNull().default("all_athletes"),
  // "all_athletes" | "team" | "individual"
  athleteUserId: varchar("athlete_user_id"),
  teamId: varchar("team_id"),
  status: varchar("status").notNull().default("draft"),
  // "draft" | "active" | "completed" | "paused"
  startDate: timestamp("start_date"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Badge Definitions
export const educationBadges = pgTable("education_badges", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id"),
  // null = system/default badge available to all orgs
  pathwayId: varchar("pathway_id"),
  name: varchar("name").notNull(),
  description: text("description"),
  icon: varchar("icon").notNull().default("trophy"),
  color: varchar("color").notNull().default("amber"),
  // "amber" | "emerald" | "blue" | "violet" | "rose" | "cyan"
  criteria: varchar("criteria").notNull().default("pathway_completed"),
  // "pathway_completed" | "quiz_perfect" | "all_modules"
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Athlete Earned Badges
export const educationAthleteBadges = pgTable("education_athlete_badges", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  athleteUserId: varchar("athlete_user_id").notNull(),
  badgeId: varchar("badge_id").notNull(),
  pathwayId: varchar("pathway_id"),
  earnedAt: timestamp("earned_at").notNull().defaultNow(),
  metadata: jsonb("metadata").notNull().default({}),
});

// AI Recommendations — coach must approve before assignment
export const educationAiRecommendations = pgTable("education_ai_recommendations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  athleteUserId: varchar("athlete_user_id").notNull(),
  pathwayId: varchar("pathway_id").notNull(),
  reasoning: text("reasoning").notNull(),
  triggerContext: jsonb("trigger_context").notNull().default({}),
  // { readinessScore, quizScore, missedSessions, triggerType }
  status: varchar("status").notNull().default("pending"),
  // "pending" | "approved" | "rejected" | "expired"
  reviewedByUserId: varchar("reviewed_by_user_id"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type EducationRule = typeof educationRules.$inferSelect;
export type EducationAssignmentPlan = typeof educationAssignmentPlans.$inferSelect;
export type EducationBadge = typeof educationBadges.$inferSelect;
export type EducationAthleteBadge = typeof educationAthleteBadges.$inferSelect;
export type EducationAiRecommendation = typeof educationAiRecommendations.$inferSelect;

// ─── Parent / Guardian Portal ─────────────────────────────────────────────────

export const parentGuardians = pgTable("parent_guardians", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  orgUserId: varchar("org_user_id").notNull(),
  relationshipType: varchar("relationship_type").notNull().default("guardian"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const athleteGuardianLinks = pgTable("athlete_guardian_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  athleteUserId: varchar("athlete_user_id").notNull(),
  guardianUserId: varchar("guardian_user_id").notNull(),
  status: varchar("status").notNull().default("pending"),
  invitedByUserId: varchar("invited_by_user_id"),
  inviteEmail: varchar("invite_email"),
  inviteToken: varchar("invite_token"),
  permissions: jsonb("permissions").notNull().default({}),
  createdAt: timestamp("created_at").defaultNow(),
  activatedAt: timestamp("activated_at"),
});

export const guardianNotifications = pgTable("guardian_notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  guardianUserId: varchar("guardian_user_id").notNull(),
  athleteUserId: varchar("athlete_user_id").notNull(),
  type: varchar("type").notNull(),
  title: varchar("title").notNull(),
  message: text("message").notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export type ParentGuardian = typeof parentGuardians.$inferSelect;
export type AthleteGuardianLink = typeof athleteGuardianLinks.$inferSelect;
export type GuardianNotification = typeof guardianNotifications.$inferSelect;

export type OrgMessage = typeof orgMessages.$inferSelect;
export type OrgMessageRead = typeof orgMessageReads.$inferSelect;
export type OrgNotification = typeof orgNotifications.$inferSelect;
export type NotificationAutomationLog = typeof notificationAutomationLogs.$inferSelect;

// ─── Org AI Integrations ──────────────────────────────────────────────────────

export const orgAiIntegrations = pgTable("org_ai_integrations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  provider: varchar("provider").notNull(), // e.g. "trainchat"
  apiKeyEncrypted: text("api_key_encrypted"),
  apiBaseUrl: text("api_base_url"),
  isActive: boolean("is_active").notNull().default(false),
  lastTestedAt: timestamp("last_tested_at"),
  lastSuccessAt: timestamp("last_success_at"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertOrgAiIntegrationSchema = createInsertSchema(orgAiIntegrations).omit({ id: true, createdAt: true, updatedAt: true });
export type OrgAiIntegration = typeof orgAiIntegrations.$inferSelect;
export type InsertOrgAiIntegration = z.infer<typeof insertOrgAiIntegrationSchema>;

// ─── Org Notification Preferences ────────────────────────────────────────────

// ─── Athlete Readiness Score + Risk Engine ────────────────────────────────────

export const athleteStatusSnapshots = pgTable("athlete_status_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  athleteUserId: varchar("athlete_user_id").notNull(),
  statusScore: integer("status_score").notNull().default(0),
  riskLevel: varchar("risk_level").notNull().default("green"),
  readinessScore: integer("readiness_score").default(0),
  adherenceScore: integer("adherence_score").default(0),
  recoveryScore: integer("recovery_score").default(0),
  educationScore: integer("education_score").default(0),
  engagementScore: integer("engagement_score").default(0),
  generatedAt: timestamp("generated_at").defaultNow(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const athleteRiskFlags = pgTable("athlete_risk_flags", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  athleteUserId: varchar("athlete_user_id").notNull(),
  flagType: varchar("flag_type").notNull(),
  severity: varchar("severity").notNull().default("info"),
  title: varchar("title").notNull(),
  summary: text("summary").notNull(),
  recommendation: text("recommendation"),
  sourceData: jsonb("source_data"),
  status: varchar("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});

export const athleteInterventionRecommendations = pgTable("athlete_intervention_recommendations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  athleteUserId: varchar("athlete_user_id").notNull(),
  recommendationType: varchar("recommendation_type").notNull(),
  generatedBy: varchar("generated_by").notNull().default("rules"),
  title: varchar("title").notNull(),
  summary: text("summary").notNull(),
  suggestedAction: text("suggested_action"),
  relatedPathwayId: varchar("related_pathway_id"),
  relatedWorkoutId: varchar("related_workout_id"),
  severity: varchar("severity").notNull().default("info"),
  status: varchar("status").notNull().default("pending"),
  coachNotes: text("coach_notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type AthleteStatusSnapshot = typeof athleteStatusSnapshots.$inferSelect;
export type AthleteRiskFlag = typeof athleteRiskFlags.$inferSelect;
export type AthleteInterventionRecommendation = typeof athleteInterventionRecommendations.$inferSelect;

// ─── Program Builder + Exercise Intelligence ──────────────────────────────────

export const exerciseLibrary = pgTable("exercise_library", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id"),
  name: varchar("name", { length: 200 }).notNull(),
  slug: varchar("slug", { length: 200 }).notNull(),
  category: varchar("category", { length: 100 }).notNull().default("strength"),
  movementPattern: varchar("movement_pattern", { length: 100 }),
  primaryMuscles: jsonb("primary_muscles").default([]),
  secondaryMuscles: jsonb("secondary_muscles").default([]),
  equipment: jsonb("equipment").default([]),
  difficulty: varchar("difficulty", { length: 50 }).default("intermediate"),
  description: text("description"),
  coachingCues: jsonb("coaching_cues").default([]),
  commonMistakes: jsonb("common_mistakes").default([]),
  progressions: jsonb("progressions").default([]),
  regressions: jsonb("regressions").default([]),
  youtubeUrl: varchar("youtube_url", { length: 500 }),
  embeddedVideoUrl: varchar("embedded_video_url", { length: 500 }),
  videoUrl: varchar("video_url", { length: 500 }),
  gifUrl: varchar("gif_url", { length: 500 }),
  thumbnailUrl: varchar("thumbnail_url", { length: 500 }),
  coachVoiceoverUrl: varchar("coach_voiceover_url", { length: 500 }),
  demoType: varchar("demo_type", { length: 30 }).default("youtube"),
  tags: jsonb("tags").default([]),
  isGlobal: boolean("is_global").notNull().default(false),
  createdByUserId: varchar("created_by_user_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const workoutSetLogs = pgTable("workout_set_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  workoutSessionId: varchar("workout_session_id").notNull(),
  athleteUserId: varchar("athlete_user_id").notNull(),
  exerciseIndex: integer("exercise_index").notNull().default(0),
  exerciseName: varchar("exercise_name", { length: 200 }).notNull(),
  setNumber: integer("set_number").notNull().default(1),
  prescribedReps: varchar("prescribed_reps", { length: 50 }),
  prescribedLoad: varchar("prescribed_load", { length: 50 }),
  actualReps: varchar("actual_reps", { length: 50 }),
  actualLoad: varchar("actual_load", { length: 50 }),
  rpe: integer("rpe"),
  completed: boolean("completed").notNull().default(false),
  durationSeconds: integer("duration_seconds"),
  notes: text("notes"),
  loggedAt: timestamp("logged_at").defaultNow(),
});

export const athleteStreaks = pgTable("athlete_streaks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  athleteUserId: varchar("athlete_user_id").notNull(),
  currentStreak: integer("current_streak").notNull().default(0),
  longestStreak: integer("longest_streak").notNull().default(0),
  lastCompletedDate: timestamp("last_completed_date"),
  totalSessionsCompleted: integer("total_sessions_completed").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type WorkoutSetLog = typeof workoutSetLogs.$inferSelect;
export type AthleteStreak = typeof athleteStreaks.$inferSelect;

export const programTemplates = pgTable("program_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id"),
  createdByUserId: varchar("created_by_user_id"),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description"),
  sport: varchar("sport", { length: 100 }),
  category: varchar("category", { length: 100 }),
  visibility: varchar("visibility", { length: 20 }).notNull().default("private"),
  templateData: jsonb("template_data").default({}),
  createdAt: timestamp("created_at").defaultNow(),
});

export const programBlocks = pgTable("program_blocks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workoutProgramId: varchar("workout_program_id").notNull(),
  weekNumber: integer("week_number").notNull(),
  title: varchar("title", { length: 200 }),
  description: text("description"),
  blockType: varchar("block_type", { length: 50 }).default("standard"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const programSessionGroups = pgTable("program_session_groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workoutSessionId: varchar("workout_session_id").notNull(),
  groupType: varchar("group_type", { length: 50 }).notNull().default("superset"),
  title: varchar("title", { length: 200 }),
  exerciseIndices: jsonb("exercise_indices").default([]),
  orderIndex: integer("order_index").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export type ExerciseLibrary = typeof exerciseLibrary.$inferSelect;
export type ProgramTemplate = typeof programTemplates.$inferSelect;
export type ProgramBlock = typeof programBlocks.$inferSelect;
export type ProgramSessionGroup = typeof programSessionGroups.$inferSelect;

// ─── Adaptive Workflow Engine ─────────────────────────────────────────────────

export const adaptiveWorkflows = pgTable("adaptive_workflows", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description"),
  triggerType: varchar("trigger_type", { length: 100 }).notNull(),
  triggerConfig: jsonb("trigger_config").default({}),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  isTemplate: boolean("is_template").notNull().default(false),
  templateKey: varchar("template_key", { length: 100 }),
  createdByUserId: varchar("created_by_user_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const adaptiveWorkflowSteps = pgTable("adaptive_workflow_steps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workflowId: varchar("workflow_id").notNull(),
  stepOrder: integer("step_order").notNull().default(1),
  actionType: varchar("action_type", { length: 100 }).notNull(),
  config: jsonb("config").default({}),
  createdAt: timestamp("created_at").defaultNow(),
});

export const adaptiveWorkflowRuns = pgTable("adaptive_workflow_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workflowId: varchar("workflow_id").notNull(),
  orgId: varchar("org_id").notNull(),
  athleteUserId: varchar("athlete_user_id").notNull(),
  triggerEvent: varchar("trigger_event", { length: 200 }),
  status: varchar("status", { length: 20 }).notNull().default("running"),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  metadata: jsonb("metadata").default({}),
});

export const adaptiveFollowups = pgTable("adaptive_followups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  athleteUserId: varchar("athlete_user_id").notNull(),
  interventionId: varchar("intervention_id"),
  workflowRunId: varchar("workflow_run_id"),
  followupDate: timestamp("followup_date").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  notes: text("notes"),
  coachUserId: varchar("coach_user_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type AdaptiveWorkflow = typeof adaptiveWorkflows.$inferSelect;
export type AdaptiveWorkflowStep = typeof adaptiveWorkflowSteps.$inferSelect;
export type AdaptiveWorkflowRun = typeof adaptiveWorkflowRuns.$inferSelect;
export type AdaptiveFollowup = typeof adaptiveFollowups.$inferSelect;

export const orgNotificationPreferences = pgTable("org_notification_preferences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  userId: varchar("user_id").notNull(),
  bookingReminders: boolean("booking_reminders").notNull().default(true),
  prUpdates: boolean("pr_updates").notNull().default(true),
  teamAnnouncements: boolean("team_announcements").notNull().default(true),
  marketingEmails: boolean("marketing_emails").notNull().default(false),
  emailEnabled: boolean("email_enabled").notNull().default(true),
  smsEnabled: boolean("sms_enabled").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── Communication Automation Engine ─────────────────────────────────────────

export const communicationCampaigns = pgTable("communication_campaigns", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  title: varchar("title").notNull(),
  type: varchar("type").notNull().default("manual"),
  status: varchar("status").notNull().default("draft"),
  createdBy: varchar("created_by").notNull(),
  audienceFilter: jsonb("audience_filter").default({}),
  scheduledAt: timestamp("scheduled_at"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const communicationMessages = pgTable("communication_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  campaignId: varchar("campaign_id"),
  orgId: varchar("org_id").notNull(),
  recipientUserId: varchar("recipient_user_id"),
  recipientType: varchar("recipient_type").notNull().default("athlete"),
  channel: varchar("channel").notNull().default("in_app"),
  messageType: varchar("message_type").notNull().default("reminder"),
  subject: varchar("subject"),
  body: text("body").notNull(),
  status: varchar("status").notNull().default("pending"),
  sentAt: timestamp("sent_at"),
  readAt: timestamp("read_at"),
  sentBy: varchar("sent_by"),
  aiGenerated: boolean("ai_generated").default(false),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow(),
});

export const communicationPreferences = pgTable("communication_preferences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  userId: varchar("user_id").notNull(),
  emailEnabled: boolean("email_enabled").notNull().default(true),
  smsEnabled: boolean("sms_enabled").notNull().default(false),
  inAppEnabled: boolean("in_app_enabled").notNull().default(true),
  guardianEnabled: boolean("guardian_enabled").notNull().default(false),
  quietHoursStart: integer("quiet_hours_start"),
  quietHoursEnd: integer("quiet_hours_end"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const communicationTemplates = pgTable("communication_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id"),
  templateType: varchar("template_type").notNull(),
  title: varchar("title").notNull(),
  subject: varchar("subject"),
  body: text("body").notNull(),
  variables: jsonb("variables").default([]),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCommunicationCampaignSchema = createInsertSchema(communicationCampaigns).omit({ id: true, createdAt: true, updatedAt: true });
export type CommunicationCampaign = typeof communicationCampaigns.$inferSelect;
export type InsertCommunicationCampaign = z.infer<typeof insertCommunicationCampaignSchema>;

export const insertCommunicationMessageSchema = createInsertSchema(communicationMessages).omit({ id: true, createdAt: true });
export type CommunicationMessage = typeof communicationMessages.$inferSelect;
export type InsertCommunicationMessage = z.infer<typeof insertCommunicationMessageSchema>;

export const insertCommunicationPreferencesSchema = createInsertSchema(communicationPreferences).omit({ id: true, createdAt: true, updatedAt: true });
export type CommunicationPreferences = typeof communicationPreferences.$inferSelect;
export type InsertCommunicationPreferences = z.infer<typeof insertCommunicationPreferencesSchema>;

export const insertCommunicationTemplateSchema = createInsertSchema(communicationTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export type CommunicationTemplate = typeof communicationTemplates.$inferSelect;
export type InsertCommunicationTemplate = z.infer<typeof insertCommunicationTemplateSchema>;

// ─── Lead Capture Programs ────────────────────────────────────────────────────

export const leadCapturePrograms = pgTable("lead_capture_programs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  programId: varchar("program_id").notNull().unique(),
  headline: text("headline").default("Train Like an Elite Athlete"),
  subheadline: text("subheadline").default("Apply now and take the first step toward your athletic potential."),
  ctaText: varchar("cta_text").default("Apply Now"),
  heroImageUrl: text("hero_image_url"),
  benefits: jsonb("benefits").default(sql`'[]'::jsonb`),
  socialProof: jsonb("social_proof").default(sql`'[]'::jsonb`),
  whoIsThisFor: text("who_is_this_for").default(""),
  // Conversion tracking
  metaPixelId: varchar("meta_pixel_id"),
  googleAdsConversionId: varchar("google_ads_conversion_id"),
  googleAdsConversionLabel: varchar("google_ads_conversion_label"),
  // v4: Booking + Revenue
  bookingUrl: text("booking_url"),
  bookingType: varchar("booking_type").default("none"),
  estimatedAthleteValueCents: integer("estimated_athlete_value_cents").default(0),
  // v5: Extended editor config (testimonials, form config, branding, hero options, who-this-is-for cards)
  extendedConfig: jsonb("extended_config").default(sql`'{}'::jsonb`),
  // v6: Funnel template system
  funnelType: varchar("funnel_type").default("athlete_application"),
  // v7: Public org menu visibility
  showInOrgMenu: boolean("show_in_org_menu").default(true).notNull(),
  navLabel: varchar("nav_label", { length: 120 }),
  navOrder: integer("nav_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertLeadCaptureProgramSchema = createInsertSchema(leadCapturePrograms).omit({ id: true, createdAt: true, updatedAt: true });
export type LeadCaptureProgram = typeof leadCapturePrograms.$inferSelect;
export type InsertLeadCaptureProgram = z.infer<typeof insertLeadCaptureProgramSchema>;

export const leadCaptureSubmissions = pgTable("lead_capture_submissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  programId: varchar("program_id").notNull(),
  athleteName: varchar("athlete_name").notNull(),
  parentName: varchar("parent_name"),
  email: varchar("email").notNull(),
  phone: varchar("phone"),
  age: varchar("age"),
  grade: varchar("grade"),
  sport: varchar("sport"),
  position: varchar("position"),
  school: varchar("school"),
  goals: text("goals").array().default(sql`'{}'::text[]`),
  experienceLevel: varchar("experience_level"),
  currentTrainingStatus: varchar("current_training_status"),
  commitmentLevel: varchar("commitment_level"),
  notes: text("notes"),
  aiQualificationScore: integer("ai_qualification_score"),
  aiQualificationReason: text("ai_qualification_reason"),
  // UTM attribution
  utmSource: varchar("utm_source"),
  utmMedium: varchar("utm_medium"),
  utmCampaign: varchar("utm_campaign"),
  utmContent: varchar("utm_content"),
  utmTerm: varchar("utm_term"),
  abandonedId: varchar("abandoned_id"),
  // v3: Follow-up sequences
  contactedAt: timestamp("contacted_at"),
  lastFollowUpAt: timestamp("last_follow_up_at"),
  followUpCount: integer("follow_up_count").default(0),
  sequenceStatus: varchar("sequence_status").default("pending"),
  aiNextAction: text("ai_next_action"),
  // v4: Booking + Revenue Intelligence
  bookingStatus: varchar("booking_status").default("not_booked"),
  bookedAt: timestamp("booked_at"),
  evaluationBookedAt: timestamp("evaluation_booked_at"),
  attendedAt: timestamp("attended_at"),
  convertedAt: timestamp("converted_at"),
  lostAt: timestamp("lost_at"),
  estimatedValueCents: integer("estimated_value_cents").default(0),
  aiSalesAnalysis: jsonb("ai_sales_analysis"),
  // Admin email audit
  adminEmailSentAt: timestamp("admin_email_sent_at"),
  adminEmailStatus: varchar("admin_email_status"),
  adminEmailError: text("admin_email_error"),
  // Applicant confirmation email audit
  applicantEmailSentAt: timestamp("applicant_email_sent_at"),
  applicantEmailStatus: varchar("applicant_email_status"),
  applicantEmailError: text("applicant_email_error"),
  // Post-submission onboarding conversion
  linkedUserId: varchar("linked_user_id"),
  signupConvertedAt: timestamp("signup_converted_at"),
  bookingConvertedAt: timestamp("booking_converted_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const leadCaptureAbandoned = pgTable("lead_capture_abandoned", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  programId: varchar("program_id").notNull(),
  athleteName: varchar("athlete_name").notNull(),
  email: varchar("email").notNull(),
  phone: varchar("phone"),
  utmSource: varchar("utm_source"),
  utmMedium: varchar("utm_medium"),
  utmCampaign: varchar("utm_campaign"),
  utmContent: varchar("utm_content"),
  utmTerm: varchar("utm_term"),
  completedAt: timestamp("completed_at"),
  submissionId: varchar("submission_id"),
  recoverySequenceStatus: varchar("recovery_sequence_status").default("pending"),
  followupSentAt: timestamp("followup_sent_at"),
  followupCount: integer("followup_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertLeadCaptureAbandonedSchema = createInsertSchema(leadCaptureAbandoned).omit({ id: true, createdAt: true });
export type LeadCaptureAbandoned = typeof leadCaptureAbandoned.$inferSelect;
export type InsertLeadCaptureAbandoned = z.infer<typeof insertLeadCaptureAbandonedSchema>;

export const insertLeadCaptureSubmissionSchema = createInsertSchema(leadCaptureSubmissions).omit({ id: true, createdAt: true });
export type LeadCaptureSubmission = typeof leadCaptureSubmissions.$inferSelect;
export type InsertLeadCaptureSubmission = z.infer<typeof insertLeadCaptureSubmissionSchema>;

export const leadCaptureFollowUps = pgTable("lead_capture_follow_ups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  submissionId: varchar("submission_id"),
  abandonedId: varchar("abandoned_id"),
  sequenceStep: varchar("sequence_step").notNull(),
  channel: varchar("channel").notNull().default("email"),
  status: varchar("status").notNull().default("sent"),
  subject: varchar("subject"),
  body: text("body"),
  sentAt: timestamp("sent_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const leadCaptureFunnelEvents = pgTable("lead_capture_funnel_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  programId: varchar("program_id").notNull(),
  eventType: varchar("event_type").notNull(),
  sessionId: varchar("session_id"),
  utmSource: varchar("utm_source"),
  utmMedium: varchar("utm_medium"),
  utmCampaign: varchar("utm_campaign"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── Coach Daily Briefings ────────────────────────────────────────────────────

export const coachDailyBriefings = pgTable("coach_daily_briefings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  generatedAt: timestamp("generated_at").defaultNow(),
  briefing: jsonb("briefing").notNull().default(sql`'{}'::jsonb`),
  generatedBy: varchar("generated_by").notNull().default("gpt-4o"),
  summary: text("summary"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCoachDailyBriefingSchema = createInsertSchema(coachDailyBriefings).omit({ id: true, createdAt: true });
export type CoachDailyBriefing = typeof coachDailyBriefings.$inferSelect;
export type InsertCoachDailyBriefing = z.infer<typeof insertCoachDailyBriefingSchema>;

// ─── Athlete Context Objects ──────────────────────────────────────────────────
// Persistent, living intelligence summaries per athlete.
// Refreshed on session completion, readiness check-in, intervention, and daily cron.

export const athleteContextObjects = pgTable("athlete_context_objects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  athleteUserId: varchar("athlete_user_id").notNull(),
  orgId: varchar("org_id").notNull(),

  // Current program state
  currentProgramId: varchar("current_program_id"),
  currentProgramWeek: integer("current_program_week"),
  currentProgramPhase: varchar("current_program_phase"),

  // Indexed trend fields (queried frequently)
  complianceRate: integer("compliance_rate"),
  readinessTrend: varchar("readiness_trend").default("unknown"),
  riskLevel: varchar("risk_level").default("green"),

  // Rich JSONB context blobs
  last30DayReadinessTrend: jsonb("last_30_day_readiness_trend").default(sql`'[]'::jsonb`),
  recentSessionFeedback: jsonb("recent_session_feedback").default(sql`'[]'::jsonb`),
  recentRPETrend: jsonb("recent_rpe_trend").default(sql`'[]'::jsonb`),
  recentPRs: jsonb("recent_prs").default(sql`'[]'::jsonb`),
  missedSessions: jsonb("missed_sessions").default(sql`'[]'::jsonb`),
  injuryNotes: jsonb("injury_notes").default(sql`'[]'::jsonb`),
  coachNotes: jsonb("coach_notes").default(sql`'[]'::jsonb`),
  interventionHistory: jsonb("intervention_history").default(sql`'[]'::jsonb`),
  educationHistory: jsonb("education_history").default(sql`'[]'::jsonb`),
  riskFlags: jsonb("risk_flags").default(sql`'[]'::jsonb`),

  // AI-generated summary of the athlete's current state
  aiSummary: text("ai_summary"),

  // Metadata
  lastRefreshTrigger: varchar("last_refresh_trigger").default("manual"),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAthleteContextObjectSchema = createInsertSchema(athleteContextObjects).omit({ id: true, createdAt: true });
export type AthleteContextObject = typeof athleteContextObjects.$inferSelect;
export type InsertAthleteContextObject = z.infer<typeof insertAthleteContextObjectSchema>;

// ─── Workout Program Generation Metadata ─────────────────────────────────────
// Stores intelligence metadata for each TrainChat generation call.

export const workoutGenerationMetadata = pgTable("workout_generation_metadata", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  workoutProgramId: varchar("workout_program_id").notNull(),
  athleteUserId: varchar("athlete_user_id"),
  contextObjectId: varchar("context_object_id"),
  readinessAdjustmentApplied: boolean("readiness_adjustment_applied").default(false),
  complianceAdjustmentApplied: boolean("compliance_adjustment_applied").default(false),
  rpeAdjustmentApplied: boolean("rpe_adjustment_applied").default(false),
  readinessTrendAtGeneration: varchar("readiness_trend_at_generation"),
  complianceRateAtGeneration: integer("compliance_rate_at_generation"),
  aiRationale: text("ai_rationale"),
  modifiersApplied: jsonb("modifiers_applied").default(sql`'[]'::jsonb`),
  generatedAt: timestamp("generated_at").defaultNow(),
});

export const insertWorkoutGenerationMetadataSchema = createInsertSchema(workoutGenerationMetadata).omit({ id: true });
export type WorkoutGenerationMetadata = typeof workoutGenerationMetadata.$inferSelect;
export type InsertWorkoutGenerationMetadata = z.infer<typeof insertWorkoutGenerationMetadataSchema>;

// ─── Program Adaptation Drafts ────────────────────────────────────────────────
// Coach-reviewable program adjustment proposals generated when context signals
// cross risk thresholds. Never auto-applied — always require coach approval.

export const programAdaptationDrafts = pgTable("program_adaptation_drafts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  athleteUserId: varchar("athlete_user_id").notNull(),
  workoutProgramId: varchar("workout_program_id"),
  contextObjectId: varchar("context_object_id").notNull(),

  // What triggered this draft
  triggerSignals: jsonb("trigger_signals").default(sql`'[]'::jsonb`),
  adaptationType: varchar("adaptation_type").notNull(),

  // Context snapshots for audit trail
  previousContextSnapshot: jsonb("previous_context_snapshot"),
  newContextSnapshot: jsonb("new_context_snapshot"),

  // The AI-generated draft content
  trainChatProgramId: varchar("trainchat_program_id"),
  trainChatRawResponse: jsonb("trainchat_raw_response"),
  draftSessions: jsonb("draft_sessions").default(sql`'[]'::jsonb`),
  adaptationRationale: text("adaptation_rationale"),

  // Review state
  status: varchar("status").notNull().default("pending_review"),
  reviewedByUserId: varchar("reviewed_by_user_id"),
  reviewedAt: timestamp("reviewed_at"),
  coachNotes: text("coach_notes"),
  educationPathwayId: varchar("education_pathway_id"),

  // Generation metadata
  generationError: text("generation_error"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertProgramAdaptationDraftSchema = createInsertSchema(programAdaptationDrafts).omit({ id: true, createdAt: true, updatedAt: true });
export type ProgramAdaptationDraft = typeof programAdaptationDrafts.$inferSelect;
export type InsertProgramAdaptationDraft = z.infer<typeof insertProgramAdaptationDraftSchema>;

// ─── Intervention Outcomes ────────────────────────────────────────────────────
// Tracks the before/after impact of every intervention that was approved and
// acted on. The learning engine reads these to improve future recommendations.

export const interventionOutcomes = pgTable("intervention_outcomes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  athleteUserId: varchar("athlete_user_id").notNull(),

  // Source: either an adaptation draft or an intervention recommendation
  adaptationDraftId: varchar("adaptation_draft_id"),
  interventionRecommendationId: varchar("intervention_recommendation_id"),
  interventionType: varchar("intervention_type").notNull(),

  // Timeline
  approvedAt: timestamp("approved_at"),
  evaluationDate: timestamp("evaluation_date"),
  evaluatedAt: timestamp("evaluated_at"),

  // Before / after metric snapshots
  readinessBefore: integer("readiness_before"),
  readinessAfter: integer("readiness_after"),
  readinessDelta: integer("readiness_delta"),

  complianceBefore: integer("compliance_before"),
  complianceAfter: integer("compliance_after"),
  complianceDelta: integer("compliance_delta"),

  rpeBefore: integer("rpe_before"),
  rpeAfter: integer("rpe_after"),
  rpeDelta: integer("rpe_delta"),

  missedSessionsBefore: integer("missed_sessions_before"),
  missedSessionsAfter: integer("missed_sessions_after"),

  riskLevelBefore: varchar("risk_level_before"),
  riskLevelAfter: varchar("risk_level_after"),

  // Full snapshots for audit
  beforeSnapshot: jsonb("before_snapshot"),
  afterSnapshot: jsonb("after_snapshot"),

  // Qualitative assessment
  coachFeedback: text("coach_feedback"),
  aiEffectivenessRating: integer("ai_effectiveness_rating"),
  outcomeStatus: varchar("outcome_status").notNull().default("pending_evaluation"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertInterventionOutcomeSchema = createInsertSchema(interventionOutcomes).omit({ id: true, createdAt: true, updatedAt: true });
export type InterventionOutcome = typeof interventionOutcomes.$inferSelect;
export type InsertInterventionOutcome = z.infer<typeof insertInterventionOutcomeSchema>;

// ─── Phase 4: Event-Driven Organizational Intelligence ───────────────────────

export const organizationEventLog = pgTable("organization_event_log", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),
  eventId: text("event_id").notNull().unique(),
  eventType: text("event_type").notNull(),
  sourceSystem: text("source_system").notNull(),
  athleteUserId: text("athlete_user_id"),
  coachUserId: text("coach_user_id"),
  payload: jsonb("payload"),
  triggeredWorkflows: jsonb("triggered_workflows"),
  resultingActions: jsonb("resulting_actions"),
  resolutionState: text("resolution_state").notNull().default("open"),
  resolvedAt: timestamp("resolved_at"),
  escalationLevel: integer("escalation_level").default(0),
  correlationId: text("correlation_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertOrganizationEventLogSchema = createInsertSchema(organizationEventLog).omit({ id: true, createdAt: true });
export type OrganizationEventLog = typeof organizationEventLog.$inferSelect;
export type InsertOrganizationEventLog = z.infer<typeof insertOrganizationEventLogSchema>;

export const organizationIntelligenceState = pgTable("organization_intelligence_state", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull().unique(),
  overallHealthScore: integer("overall_health_score").default(100),
  interventionLoad: integer("intervention_load").default(0),
  criticalAthleteCount: integer("critical_athlete_count").default(0),
  unresolvedCriticalAthletes: jsonb("unresolved_critical_athletes"),
  coachWorkloadScore: integer("coach_workload_score").default(0),
  complianceHealthScore: integer("compliance_health_score").default(100),
  engagementTrendDirection: text("engagement_trend_direction").default("stable"),
  fatigueRiskLevel: text("fatigue_risk_level").default("low"),
  recoveryTrendDirection: text("recovery_trend_direction").default("stable"),
  readinessDistribution: jsonb("readiness_distribution"),
  predictedChurnRisks: integer("predicted_churn_risks").default(0),
  unresolvedInterventions: integer("unresolved_interventions").default(0),
  lastDailyOpsAt: timestamp("last_daily_ops_at"),
  lastUpdatedAt: timestamp("last_updated_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertOrganizationIntelligenceStateSchema = createInsertSchema(organizationIntelligenceState).omit({ id: true, updatedAt: true });
export type OrganizationIntelligenceState = typeof organizationIntelligenceState.$inferSelect;
export type InsertOrganizationIntelligenceState = z.infer<typeof insertOrganizationIntelligenceStateSchema>;

// ─── Unified Agent Action Log ─────────────────────────────────────────────────
// Central audit table for all AI/automation activity across the platform.
// actorType:  agent | system | admin | coach
// status:     started | completed | failed | skipped | requires_approval
// riskLevel:  low | medium | high | critical

export const unifiedAgentActionLog = pgTable("unified_agent_action_log", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),

  // Who/what performed the action
  actorType: text("actor_type").notNull().default("system"),
  actorName: text("actor_name"),

  // What was done
  actionType: text("action_type").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),

  // Traceability
  workflowRunId: text("workflow_run_id"),
  toolName: text("tool_name"),

  // Outcome
  status: text("status").notNull().default("completed"),
  confidenceScore: doublePrecision("confidence_score"),
  riskLevel: text("risk_level").default("low"),

  // Payload snapshots
  inputSnapshot: jsonb("input_snapshot"),
  outputSnapshot: jsonb("output_snapshot"),

  // Human-readable context
  reasoningSummary: text("reasoning_summary"),
  errorMessage: text("error_message"),

  // Rollback capability
  rollbackAvailable: boolean("rollback_available").default(false),

  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUnifiedAgentActionLogSchema = createInsertSchema(unifiedAgentActionLog).omit({ id: true, createdAt: true });
export type UnifiedAgentActionLog = typeof unifiedAgentActionLog.$inferSelect;
export type InsertUnifiedAgentActionLog = z.infer<typeof insertUnifiedAgentActionLogSchema>;

// ─── Apex Recommendations ─────────────────────────────────────────────────────
// Dedicated table for Apex agent recommendations with lifecycle management.
// Dedup key: (org_id, signal_type, entity_id) — only one pending_review rec per signal.
export const apexRecommendations = pgTable("apex_recommendations", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),

  // Signal identity (dedup key enforced at application level)
  signalType: text("signal_type").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  entityName: text("entity_name"),

  // Content
  urgency: text("urgency").notNull().default("medium"),
  estimatedValueCents: integer("estimated_value_cents").default(0),
  reasonText: text("reason_text"),
  recommendedAction: text("recommended_action"),
  confidenceScore: doublePrecision("confidence_score"),
  staleDays: integer("stale_days").default(0),
  sourceUrl: text("source_url"),

  // Status lifecycle: pending_review → approved | dismissed | completed | expired
  status: text("status").notNull().default("pending_review"),
  statusUpdatedAt: timestamp("status_updated_at"),
  statusUpdatedBy: text("status_updated_by"),
  dismissReason: text("dismiss_reason"),

  // Traceability
  runId: text("run_id"),

  // Expiry (default 7 days from creation)
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertApexRecommendationSchema = createInsertSchema(apexRecommendations).omit({ id: true, createdAt: true });
export type ApexRecommendation = typeof apexRecommendations.$inferSelect;
export type InsertApexRecommendation = z.infer<typeof insertApexRecommendationSchema>;

// ─── Workflow Context (Memory) ────────────────────────────────────────────────
// Persistent memory for workflows, entities, and organizational patterns.
// entityType: athlete | lead | coach | workflow | campaign | client
// contextType: interaction_history | workflow_memory | business_memory |
//              communication_memory | operator_override | ai_reasoning_memory
// createdBy: system | agent | admin | coach

export const workflowContext = pgTable("workflow_context", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),

  // What entity this memory is about
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),

  // Type of memory
  contextType: text("context_type").notNull(),

  // Human-readable summary of this memory
  summary: text("summary").notNull(),

  // Structured data payload (flexible)
  structuredContext: jsonb("structured_context"),

  // Outcome tracking
  lastOutcome: text("last_outcome"),
  lastConfidenceScore: doublePrecision("last_confidence_score"),

  // Memory importance for lifecycle management
  memoryImportanceScore: doublePrecision("memory_importance_score").default(0.5),

  // Traceability
  sourceWorkflowId: text("source_workflow_id"),
  sourceActionLogId: text("source_action_log_id"),

  // Who created this memory
  createdBy: text("created_by").notNull().default("system"),

  // Lifecycle flags
  archived: boolean("archived").default(false),
  compressed: boolean("compressed").default(false),
  neverDelete: boolean("never_delete").default(false),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertWorkflowContextSchema = createInsertSchema(workflowContext).omit({ id: true, createdAt: true, updatedAt: true });
export type WorkflowContext = typeof workflowContext.$inferSelect;
export type InsertWorkflowContext = z.infer<typeof insertWorkflowContextSchema>;

// ─── Workflow Outcomes ────────────────────────────────────────────────────────
// Tracks measurable business outcomes from autonomous/semi-autonomous workflows.
// outcomeType: converted | retained | booked | failed | ignored |
//              escalated | cancelled | recovered

export const workflowOutcomes = pgTable("workflow_outcomes", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),

  // Which workflow run produced this outcome
  workflowRunId: text("workflow_run_id").notNull(),
  workflowType: text("workflow_type").notNull(),

  // The entity the workflow acted upon
  entityType: text("entity_type"),
  entityId: text("entity_id"),

  // Outcome classification
  outcomeType: text("outcome_type").notNull(),

  // Scoring
  outcomeScore: doublePrecision("outcome_score"),
  revenueImpact: doublePrecision("revenue_impact"),
  retentionImpact: doublePrecision("retention_impact"),
  engagementImpact: doublePrecision("engagement_impact"),

  // Accuracy tracking (was the AI confidence accurate?)
  confidenceAccuracyDelta: doublePrecision("confidence_accuracy_delta"),

  // Operator interaction flags
  aiRecommendationUsed: boolean("ai_recommendation_used").default(true),
  operatorModified: boolean("operator_modified").default(false),

  // Summary
  outcomeSummary: text("outcome_summary"),

  createdAt: timestamp("created_at").defaultNow(),
});

export const insertWorkflowOutcomesSchema = createInsertSchema(workflowOutcomes).omit({ id: true, createdAt: true });
export type WorkflowOutcome = typeof workflowOutcomes.$inferSelect;
export type InsertWorkflowOutcome = z.infer<typeof insertWorkflowOutcomesSchema>;

// ─── Agent Capability Policies ────────────────────────────────────────────────
// Per-org, per-agent capability configuration. Every agent action passes through
// these policies before execution.
// agentType: executive_agent | growth_agent | retention_agent | scheduling_agent |
//            finance_agent | communication_agent | research_agent | workflow_agent | system_agent
// maxAutonomyLevel: supervised | collaborative | autonomous
// allowedRiskLevels: low | medium | high | critical

export const agentCapabilityPolicies = pgTable("agent_capability_policies", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),

  // Which agent this policy applies to
  agentType: text("agent_type").notNull(),
  capabilityName: text("capability_name").notNull(),
  capabilityCategory: text("capability_category").notNull(),

  // Enablement
  enabled: boolean("enabled").default(true),
  requiresApproval: boolean("requires_approval").default(true),

  // Autonomy
  maxAutonomyLevel: text("max_autonomy_level").notNull().default("supervised"),
  minimumConfidenceScore: doublePrecision("minimum_confidence_score").default(0.75),
  allowedRiskLevels: text("allowed_risk_levels").array().default(["low"]),

  // Review & escalation
  requiresHumanReview: boolean("requires_human_review").default(true),
  escalationRequired: boolean("escalation_required").default(false),

  // Execution quotas (JSON: maxEmailsPerHour, maxWorkflowExecutionsPerDay, etc.)
  executionLimits: jsonb("execution_limits"),

  // Tool access control
  allowedTools: jsonb("allowed_tools"),   // string[] | null = all allowed
  restrictedTools: jsonb("restricted_tools"), // string[] | null = none restricted

  notes: text("notes"),
  createdBy: text("created_by").default("system"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAgentCapabilityPoliciesSchema = createInsertSchema(agentCapabilityPolicies).omit({ id: true, createdAt: true, updatedAt: true });
export type AgentCapabilityPolicy = typeof agentCapabilityPolicies.$inferSelect;
export type InsertAgentCapabilityPolicy = z.infer<typeof insertAgentCapabilityPoliciesSchema>;

// ─── Org AI Governance Settings ───────────────────────────────────────────────
// Central organizational AI governance profile. One row per org.
// defaultAutonomyMode: supervised | collaborative | autonomous
// maximumAllowedRiskLevel: low | medium | high | critical
// aiActivityVisibilityMode: full | summarized | minimal

export const orgAiGovernanceSettings = pgTable("org_ai_governance_settings", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull().unique(),

  // Global autonomy mode
  defaultAutonomyMode: text("default_autonomy_mode").notNull().default("supervised"),
  maximumAllowedRiskLevel: text("maximum_allowed_risk_level").notNull().default("medium"),
  defaultConfidenceThreshold: doublePrecision("default_confidence_threshold").default(0.75),

  // Review controls
  operatorReviewRequired: boolean("operator_review_required").default(true),

  // Feature flags
  allowAutonomousCommunication: boolean("allow_autonomous_communication").default(false),
  allowAutonomousScheduling: boolean("allow_autonomous_scheduling").default(false),
  allowAutonomousFinancialActions: boolean("allow_autonomous_financial_actions").default(false),
  allowResearchAgents: boolean("allow_research_agents").default(true),
  allowExternalWebAccess: boolean("allow_external_web_access").default(false),
  allowCrossWorkflowMemory: boolean("allow_cross_workflow_memory").default(true),

  // Observability
  aiActivityVisibilityMode: text("ai_activity_visibility_mode").default("full"),

  // Safety
  strictModeEnabled: boolean("strict_mode_enabled").default(false),
  emergencyPauseEnabled: boolean("emergency_pause_enabled").default(false),
  emergencyPauseReason: text("emergency_pause_reason"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertOrgAiGovernanceSettingsSchema = createInsertSchema(orgAiGovernanceSettings).omit({ id: true, createdAt: true, updatedAt: true });
export type OrgAiGovernanceSettings = typeof orgAiGovernanceSettings.$inferSelect;
export type InsertOrgAiGovernanceSettings = z.infer<typeof insertOrgAiGovernanceSettingsSchema>;

// ─── Workflow Jobs ────────────────────────────────────────────────────────────
// Durable job queue for every agent action, workflow step, tool call, and
// scheduled trigger. Every mutating operation goes through here.
// jobType: workflow_step | tool_execution | scheduled_trigger | retry |
//          approval_timeout | memory_lifecycle | business_brain_run | notification
// status: queued | running | completed | failed | retrying | cancelled | dead_letter | paused
// priority: low | normal | high | critical
// errorType: transient | blocked | fatal | governance | timeout | rate_limited

export const workflowJobs = pgTable("workflow_jobs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),

  workflowRunId: text("workflow_run_id"),
  workflowStepId: text("workflow_step_id"),

  jobType: text("job_type").notNull().default("workflow_step"),
  status: text("status").notNull().default("queued"),
  priority: text("priority").notNull().default("normal"),

  // Scheduling
  scheduledFor: timestamp("scheduled_for").defaultNow(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  failedAt: timestamp("failed_at"),

  // Retry tracking
  attempts: integer("attempts").default(0),
  maxAttempts: integer("max_attempts").default(3),
  nextRetryAt: timestamp("next_retry_at"),
  retryBackoffMs: integer("retry_backoff_ms").default(5000),

  // Failure details
  lastError: text("last_error"),
  errorType: text("error_type"), // transient | blocked | fatal | governance | timeout | rate_limited

  // Data
  payload: jsonb("payload"),
  result: jsonb("result"),

  // Idempotency + locking
  idempotencyKey: text("idempotency_key").unique(),
  lockedBy: text("locked_by"),
  lockedAt: timestamp("locked_at"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertWorkflowJobsSchema = createInsertSchema(workflowJobs).omit({ id: true, createdAt: true, updatedAt: true });
export type WorkflowJob = typeof workflowJobs.$inferSelect;
export type InsertWorkflowJob = z.infer<typeof insertWorkflowJobsSchema>;

// ─── Agent Execution Locks ────────────────────────────────────────────────────
// Prevent race conditions: two workflows cannot act on the same entity at once.
// Locks expire automatically (expiresAt) to prevent deadlocks.

export const agentExecutionLocks = pgTable("agent_execution_locks", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),
  lockKey: text("lock_key").notNull().unique(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  workflowRunId: text("workflow_run_id"),
  lockedBy: text("locked_by").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type AgentExecutionLock = typeof agentExecutionLocks.$inferSelect;

// ─── Org Execution Rate Limits ────────────────────────────────────────────────
// Per-org, per-category rate limit tracking.
// category: communication | scheduling | finance | research | workflow | ai_reasoning
// limitWindow: minute | hour | day

export const orgExecutionRateLimits = pgTable("org_execution_rate_limits", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),
  category: text("category").notNull(),
  limitWindow: text("limit_window").notNull().default("hour"),
  maxExecutions: integer("max_executions").notNull().default(50),
  currentCount: integer("current_count").default(0),
  resetAt: timestamp("reset_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertOrgExecutionRateLimitsSchema = createInsertSchema(orgExecutionRateLimits).omit({ id: true, createdAt: true, updatedAt: true });
export type OrgExecutionRateLimit = typeof orgExecutionRateLimits.$inferSelect;
export type InsertOrgExecutionRateLimit = z.infer<typeof insertOrgExecutionRateLimitsSchema>;

// ─── External Integrations ────────────────────────────────────────────────────
// Central registry of all external system connections per org.
// ALL external execution flows through integration-runtime.ts — never directly.

export const externalIntegrations = pgTable("external_integrations", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),
  integrationType: text("integration_type").notNull(), // gmail | google_calendar | slack | openrouter | claude | meta_ads | hubspot | twilio | discord | custom_webhook
  status: text("status").notNull().default("disconnected"), // connected | disconnected | degraded | paused | error
  displayName: text("display_name"),
  authType: text("auth_type").notNull().default("api_key"), // oauth | api_key | webhook
  encryptedCredentials: jsonb("encrypted_credentials").default({}),
  scopes: jsonb("scopes").default([]),
  lastHealthCheckAt: timestamp("last_health_check_at"),
  lastSuccessfulActionAt: timestamp("last_successful_action_at"),
  lastFailureAt: timestamp("last_failure_at"),
  lastFailureReason: text("last_failure_reason"),
  rateLimitState: jsonb("rate_limit_state").default({}),
  usageStats: jsonb("usage_stats").default({}),
  governanceRestrictions: jsonb("governance_restrictions").default({}),
  enabledAgents: jsonb("enabled_agents").default([]),
  enabledTools: jsonb("enabled_tools").default([]),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertExternalIntegrationSchema = createInsertSchema(externalIntegrations).omit({ id: true, createdAt: true, updatedAt: true });
export type ExternalIntegration = typeof externalIntegrations.$inferSelect;
export type InsertExternalIntegration = z.infer<typeof insertExternalIntegrationSchema>;

// ─── Integration Execution Log ────────────────────────────────────────────────
// Immutable audit trail for every action executed through the integration runtime.

export const integrationExecutionLog = pgTable("integration_execution_log", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),
  integrationId: text("integration_id"),
  integrationType: text("integration_type").notNull(),
  actionType: text("action_type").notNull(),
  agentType: text("agent_type"),
  workflowJobId: text("workflow_job_id"),
  workflowRunId: text("workflow_run_id"),
  idempotencyKey: text("idempotency_key"),
  status: text("status").notNull().default("pending"), // pending | success | failed | blocked | rate_limited
  inputSummary: text("input_summary"),
  resultSummary: text("result_summary"),
  errorMessage: text("error_message"),
  errorClass: text("error_class"), // transient | permanent | rate_limited | auth | governance
  providerStatusCode: integer("provider_status_code"),
  latencyMs: integer("latency_ms"),
  tokensUsed: integer("tokens_used"),
  costCents: integer("cost_cents"),
  modelUsed: text("model_used"),
  governanceChecked: boolean("governance_checked").default(false),
  governanceDecision: text("governance_decision"), // allowed | blocked | approval_required
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const insertIntegrationExecutionLogSchema = createInsertSchema(integrationExecutionLog).omit({ id: true, createdAt: true });
export type IntegrationExecutionLog = typeof integrationExecutionLog.$inferSelect;
export type InsertIntegrationExecutionLog = z.infer<typeof insertIntegrationExecutionLogSchema>;

// ─── Workflow Graphs ──────────────────────────────────────────────────────────
// Visual workflow definitions built in the Workflow Builder.
// These compile into executable WorkflowJobs via the graph engine.

export const workflowGraphs = pgTable("workflow_graphs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category").notNull().default("custom"), // onboarding | retention | outreach | scheduling | research | executive | custom
  graphVersion: integer("graph_version").notNull().default(1),
  graphDefinition: jsonb("graph_definition").notNull().default({}), // { nodes: [], edges: [], viewport: {} }
  compiledDefinition: jsonb("compiled_definition"), // compiled execution plan
  riskLevel: text("risk_level").notNull().default("low"), // low | medium | high | critical
  estimatedComplexity: integer("estimated_complexity").default(0), // node count + edge complexity score
  estimatedExecutionCostCents: integer("estimated_execution_cost_cents").default(0),
  requiresApproval: boolean("requires_approval").notNull().default(false),
  governanceWarnings: jsonb("governance_warnings").default([]),
  tags: jsonb("tags").default([]),
  published: boolean("published").notNull().default(false),
  active: boolean("active").notNull().default(true),
  isTemplate: boolean("is_template").notNull().default(false),
  templateRating: integer("template_rating"),
  sourceTemplateId: text("source_template_id"),
  createdBy: text("created_by"),
  lastCompiledAt: timestamp("last_compiled_at"),
  lastSimulatedAt: timestamp("last_simulated_at"),
  lastPublishedAt: timestamp("last_published_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertWorkflowGraphSchema = createInsertSchema(workflowGraphs).omit({ id: true, createdAt: true, updatedAt: true });
export type WorkflowGraph = typeof workflowGraphs.$inferSelect;
export type InsertWorkflowGraph = z.infer<typeof insertWorkflowGraphSchema>;

// ─── Workflow Graph Versions ──────────────────────────────────────────────────
// Immutable snapshots of published workflow graphs — active runs pin to a version.

export const workflowGraphVersions = pgTable("workflow_graph_versions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),
  graphId: text("graph_id").notNull(),
  versionNumber: integer("version_number").notNull(),
  snapshotDefinition: jsonb("snapshot_definition").notNull().default({}),
  compiledDefinition: jsonb("compiled_definition"),
  riskLevel: text("risk_level").notNull().default("low"),
  changeNotes: text("change_notes"),
  publishedBy: text("published_by"),
  publishedAt: timestamp("published_at").defaultNow(),
  isActive: boolean("is_active").notNull().default(false),
});

export const insertWorkflowGraphVersionSchema = createInsertSchema(workflowGraphVersions).omit({ id: true, publishedAt: true });
export type WorkflowGraphVersion = typeof workflowGraphVersions.$inferSelect;
export type InsertWorkflowGraphVersion = z.infer<typeof insertWorkflowGraphVersionSchema>;

// ─── Gmail Conversations ──────────────────────────────────────────────────────
// Tracks linked Gmail threads to leads/deals/clients.

export const gmailConversations = pgTable("gmail_conversations", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),
  leadId: text("lead_id"),
  dealId: text("deal_id"),
  clientId: text("client_id"),
  gmailThreadId: text("gmail_thread_id").notNull(),
  lastMessageId: text("last_message_id"),
  subject: text("subject"),
  participantEmail: text("participant_email"),
  participantName: text("participant_name"),
  status: text("status").notNull().default("open"),
  intent: text("intent"),
  lastInboundAt: timestamp("last_inbound_at"),
  lastOutboundAt: timestamp("last_outbound_at"),
  lastSnippet: text("last_snippet"),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertGmailConversationSchema = createInsertSchema(gmailConversations).omit({ id: true, createdAt: true, updatedAt: true });
export type GmailConversation = typeof gmailConversations.$inferSelect;
export type InsertGmailConversation = z.infer<typeof insertGmailConversationSchema>;

// ─── Gmail Agent Actions ──────────────────────────────────────────────────────
// Audit log for every gmail send/draft/read/classify action the agent takes.

export const gmailAgentActions = pgTable("gmail_agent_actions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),
  actionType: text("action_type").notNull(),
  gmailThreadId: text("gmail_thread_id"),
  gmailMessageId: text("gmail_message_id"),
  leadId: text("lead_id"),
  dealId: text("deal_id"),
  recipientEmail: text("recipient_email"),
  subject: text("subject"),
  bodyPreview: text("body_preview"),
  riskLevel: text("risk_level").notNull().default("medium"),
  approvalRequired: boolean("approval_required").notNull().default(true),
  status: text("status").notNull().default("proposed"),
  result: jsonb("result"),
  errorMessage: text("error_message"),
  createdByAgent: text("created_by_agent"),
  approvedBy: text("approved_by"),
  createdAt: timestamp("created_at").defaultNow(),
  executedAt: timestamp("executed_at"),
  communicationDomain: text("communication_domain").default("athlete_lead"),
});

export const insertGmailAgentActionSchema = createInsertSchema(gmailAgentActions).omit({ id: true, createdAt: true });
export type GmailAgentAction = typeof gmailAgentActions.$inferSelect;
export type InsertGmailAgentAction = z.infer<typeof insertGmailAgentActionSchema>;

// ─── Agent Message Feedback ───────────────────────────────────────────────────
// Every human review decision becomes training data for agent improvement.

export const agentMessageFeedback = pgTable("agent_message_feedback", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),
  proposalId: text("proposal_id").notNull(),
  leadId: text("lead_id"),
  agentName: text("agent_name"),
  messageType: text("message_type"),
  originalSubject: text("original_subject"),
  originalBody: text("original_body"),
  editedSubject: text("edited_subject"),
  editedBody: text("edited_body"),
  decision: text("decision").notNull(), // approved | edited_and_approved | rejected
  rejectionReason: text("rejection_reason"),
  qualityRating: integer("quality_rating"),
  reviewerNotes: text("reviewer_notes"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at").defaultNow(),
  leadContextJson: jsonb("lead_context_json"),
  outcome: text("outcome"), // sent | replied | booked | ignored | bounced
  createdAt: timestamp("created_at").defaultNow(),
  // ── Coaching feedback fields ──
  coachingFeedbackText: text("coaching_feedback_text"),
  feedbackTags: jsonb("feedback_tags"),           // string[]
  extractedPreferences: jsonb("extracted_preferences"),
  extractedAvoidRules: jsonb("extracted_avoid_rules"),
  extractedDoRules: jsonb("extracted_do_rules"),
  appliestoLeadType: text("applies_to_lead_type"),
  appliestoProgram: text("applies_to_program"),
  preferenceStrength: text("preference_strength"), // weak | medium | strong
  shouldApplyGlobally: boolean("should_apply_globally").default(false),
  communicationDomain: text("communication_domain").default("athlete_lead"),
  outcomeData: jsonb("outcome_data"),
  appliedToFutureRuns: boolean("applied_to_future_runs").default(false),
});
export type AgentMessageFeedback = typeof agentMessageFeedback.$inferSelect;

// ─── Agent Message Learning Rules ────────────────────────────────────────────
// Durable rules extracted from human feedback; injected into future generation.

export const agentMessageLearningRules = pgTable("agent_message_learning_rules", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),
  sourceFeedbackId: text("source_feedback_id"),
  ruleType: text("rule_type").notNull(), // do | avoid | tone | cta | length | personalization | lead_stage
  ruleText: text("rule_text").notNull(),
  messageType: text("message_type"),
  leadType: text("lead_type"),
  program: text("program"),
  appliesGlobally: boolean("applies_globally").default(false),
  confidence: text("confidence").default("0.80"),
  weight: integer("weight").default(1),
  status: text("status").default("active"), // active | superseded | archived
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  lastAppliedAt: timestamp("last_applied_at"),
  timesApplied: integer("times_applied").default(0),
  successCount: integer("success_count").default(0),
  rejectionCount: integer("rejection_count").default(0),
  communicationDomain: text("communication_domain").default("athlete_lead"),
});
export type AgentMessageLearningRule = typeof agentMessageLearningRules.$inferSelect;

// ─── Agent Message Revisions ──────────────────────────────────────────────────
// Revision history when an admin uses "Regenerate with feedback".

export const agentMessageRevisions = pgTable("agent_message_revisions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  proposalId: text("proposal_id").notNull(),
  orgId: text("org_id").notNull(),
  revisionNumber: integer("revision_number").notNull().default(1),
  originalSubject: text("original_subject"),
  originalBody: text("original_body"),
  revisedSubject: text("revised_subject"),
  revisedBody: text("revised_body"),
  feedbackUsed: text("feedback_used"),
  createdAt: timestamp("created_at").defaultNow(),
  createdBy: text("created_by"),
});
export type AgentMessageRevision = typeof agentMessageRevisions.$inferSelect;

// ─── Agent Autonomy Settings ──────────────────────────────────────────────────
// Per-org, per-message-type autonomy level controls.

export const agentAutonomySettings = pgTable("agent_autonomy_settings", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),
  messageType: text("message_type").notNull(),
  autonomyLevel: integer("autonomy_level").notNull().default(0),
  enabled: boolean("enabled").notNull().default(false),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  communicationDomain: text("communication_domain").default("athlete_lead"),
});
export type AgentAutonomySetting = typeof agentAutonomySettings.$inferSelect;

// ─── Lead Intelligence Profiles ───────────────────────────────────────────────
// Stores AI-generated context, lead scoring, and pipeline state for every
// athlete lead captured via a landing page / application form.

export const leadIntelligenceProfiles = pgTable("lead_intelligence_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  submissionId: varchar("submission_id").notNull().unique(),
  // Pipeline stage
  pipelineStage: varchar("pipeline_stage").notNull().default("new_lead"),
  // AI-generated summary
  aiSummary: text("ai_summary"),
  // Normalized intake profile (full object persisted as JSONB)
  normalizedProfileJson: jsonb("normalized_profile_json"),
  // Lead scoring
  leadScore: integer("lead_score"),
  temperature: varchar("temperature"),
  urgency: varchar("urgency"),
  // Suggested next action
  suggestedNextAction: varchar("suggested_next_action"),
  suggestedNextActionReason: text("suggested_next_action_reason"),
  // Campaign attribution
  campaignSource: varchar("campaign_source"),
  campaignMedium: varchar("campaign_medium"),
  campaignName: varchar("campaign_name"),
  landingPageId: varchar("landing_page_id"),
  programId: varchar("program_id"),
  // Tags
  tags: text("tags").array().default(sql`'{}'::text[]`),
  // Gmail draft action created
  gmailDraftActionId: varchar("gmail_draft_action_id"),
  initialDraftSubject: text("initial_draft_subject"),
  initialDraftBody: text("initial_draft_body"),
  // Follow-up tracking
  followUpStage: varchar("follow_up_stage").default("none"),
  lastInteractionAt: timestamp("last_interaction_at"),
  nextFollowUpAt: timestamp("next_follow_up_at"),
  // Suppression / unsubscribe
  unsubscribed: boolean("unsubscribed").notNull().default(false),
  suppressed: boolean("suppressed").notNull().default(false),
  suppressionReason: text("suppression_reason"),
  suppressedAt: timestamp("suppressed_at"),
  // Stage transition audit history [{fromStage,toStage,reason,source,confidence,timestamp}]
  stageTransitions: jsonb("stage_transitions").notNull().default(sql`'[]'::jsonb`),
  // Processing audit
  intakeProcessedAt: timestamp("intake_processed_at"),
  scoringProcessedAt: timestamp("scoring_processed_at"),
  draftGeneratedAt: timestamp("draft_generated_at"),
  processingLog: jsonb("processing_log").default(sql`'[]'::jsonb`),
  processingDurationMs: integer("processing_duration_ms"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertLeadIntelligenceProfileSchema = createInsertSchema(leadIntelligenceProfiles).omit({ id: true, createdAt: true, updatedAt: true });
export type LeadIntelligenceProfile = typeof leadIntelligenceProfiles.$inferSelect;
export type InsertLeadIntelligenceProfile = z.infer<typeof insertLeadIntelligenceProfileSchema>;

// ─── Lead Scheduling Contexts ─────────────────────────────────────────────────
// Tracks the scheduling lifecycle for a lead from slot offer → confirmation → booking.

export const leadSchedulingContexts = pgTable("lead_scheduling_contexts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  leadId: varchar("lead_id").notNull(),
  submissionId: varchar("submission_id").notNull().unique(),
  gmailThreadId: varchar("gmail_thread_id"),
  offeredSlots: jsonb("offered_slots").notNull().default(sql`'[]'::jsonb`),
  selectedSlot: jsonb("selected_slot"),
  // Status: none | slots_offered | awaiting_confirmation | booked | expired | cancelled
  status: varchar("status").notNull().default("none"),
  expiresAt: timestamp("expires_at"),
  athleticBookingId: varchar("athletic_booking_id"),
  lastReplyMessageId: varchar("last_reply_message_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertLeadSchedulingContextSchema = createInsertSchema(leadSchedulingContexts).omit({ id: true, createdAt: true, updatedAt: true });
export type LeadSchedulingContext = typeof leadSchedulingContexts.$inferSelect;
export type InsertLeadSchedulingContext = z.infer<typeof insertLeadSchedulingContextSchema>;

// ─── Org Automation Settings ──────────────────────────────────────────────────
// Granular per-org settings for the Autonomy Policy Engine.
// All dangerous settings default to false (safe by default).

export const orgAutomationSettings = pgTable("org_automation_settings", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull().unique(),

  // Email automation
  autoSendFirstResponse: boolean("auto_send_first_response").notNull().default(false),
  autoSendLowRiskFollowUps: boolean("auto_send_low_risk_follow_ups").notNull().default(false),
  autoSendBookingConfirmation: boolean("auto_send_booking_confirmation").notNull().default(false),

  // Scheduling automation
  autoOfferSchedulingSlots: boolean("auto_offer_scheduling_slots").notNull().default(false),
  autoBookConfirmedSlots: boolean("auto_book_confirmed_slots").notNull().default(false),

  // Confidence thresholds
  minAutoSendConfidence: doublePrecision("min_auto_send_confidence").notNull().default(0.85),
  minAutoBookingConfidence: doublePrecision("min_auto_booking_confidence").notNull().default(0.90),

  // Daily rate caps
  dailyEmailCap: integer("daily_email_cap").notNull().default(20),
  dailyBookingCap: integer("daily_booking_cap").notNull().default(10),

  // Allowed send window (HH:MM 24h format)
  allowedSendWindowStart: text("allowed_send_window_start").notNull().default("08:00"),
  allowedSendWindowEnd: text("allowed_send_window_end").notNull().default("20:00"),

  // Approval gates
  requireApprovalForFirstContact: boolean("require_approval_for_first_contact").notNull().default(true),
  requireApprovalForNewRecipients: boolean("require_approval_for_new_recipients").notNull().default(true),
  notifyCoachOnAutoAction: boolean("notify_coach_on_auto_action").notNull().default(true),

  policyVersion: text("policy_version").notNull().default("1.0.0"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertOrgAutomationSettingsSchema = createInsertSchema(orgAutomationSettings).omit({ id: true, createdAt: true, updatedAt: true });
export type OrgAutomationSettings = typeof orgAutomationSettings.$inferSelect;
export type InsertOrgAutomationSettings = z.infer<typeof insertOrgAutomationSettingsSchema>;

// ─── Agent Autonomy Decisions ─────────────────────────────────────────────────
// Full audit log of every policy evaluation — who asked, what was decided, why.

export const agentAutonomyDecisions = pgTable("agent_autonomy_decisions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),
  actionId: text("action_id"),
  leadId: text("lead_id"),
  dealId: text("deal_id"),
  actionType: text("action_type").notNull(),
  decision: text("decision").notNull(),  // auto_execute | approval_required | blocked
  reasons: jsonb("reasons").notNull().default(sql`'[]'::jsonb`),
  confidence: doublePrecision("confidence").notNull().default(0),
  riskLevel: text("risk_level").notNull().default("medium"),
  policyVersion: text("policy_version").notNull().default("1.0.0"),
  settingsSnapshot: jsonb("settings_snapshot"),
  createdAt: timestamp("created_at").defaultNow(),
  executedAt: timestamp("executed_at"),
  result: text("result"),
  errorMessage: text("error_message"),
});

export const insertAgentAutonomyDecisionSchema = createInsertSchema(agentAutonomyDecisions).omit({ id: true, createdAt: true });
export type AgentAutonomyDecision = typeof agentAutonomyDecisions.$inferSelect;
export type InsertAgentAutonomyDecision = z.infer<typeof insertAgentAutonomyDecisionSchema>;

// ─── Workflow Registry ────────────────────────────────────────────────────────
// Unified catalog of system, template, and org-custom workflows.

export const workflowRegistry = pgTable("workflow_registry", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),
  workflowKey: text("workflow_key").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  workflowType: text("workflow_type").notNull().default("custom"),
  // lead_pipeline | outreach | scheduling | recovery | retention | automation | governance | custom
  source: text("source").notNull().default("org_custom"),
  // system | template | org_custom
  protected: boolean("protected").notNull().default(false),
  editable: boolean("editable").notNull().default(true),
  enabled: boolean("enabled").notNull().default(true),
  systemManaged: boolean("system_managed").notNull().default(false),
  version: text("version").notNull().default("1.0.0"),
  clonedFromWorkflowId: text("cloned_from_workflow_id"),
  executionCount: integer("execution_count").notNull().default(0),
  successCount: integer("success_count").notNull().default(0),
  failureCount: integer("failure_count").notNull().default(0),
  blockedCount: integer("blocked_count").notNull().default(0),
  lastRunAt: timestamp("last_run_at"),
  lastSuccessAt: timestamp("last_success_at"),
  lastFailureAt: timestamp("last_failure_at"),
  estimatedRevenueInfluenced: integer("estimated_revenue_influenced").notNull().default(0),
  estimatedBookingsCreated: integer("estimated_bookings_created").notNull().default(0),
  estimatedLeadsConverted: integer("estimated_leads_converted").notNull().default(0),
  workflowDefinition: jsonb("workflow_definition").default({}),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  triggerTypes: text("trigger_types").array().notNull().default(sql`'{}'::text[]`),
  actionTypes: text("action_types").array().notNull().default(sql`'{}'::text[]`),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertWorkflowRegistrySchema = createInsertSchema(workflowRegistry).omit({ id: true, createdAt: true, updatedAt: true });
export type WorkflowRegistry = typeof workflowRegistry.$inferSelect;
export type InsertWorkflowRegistry = z.infer<typeof insertWorkflowRegistrySchema>;

// ─── Workflow Conflicts ───────────────────────────────────────────────────────

export const workflowConflicts = pgTable("workflow_conflicts", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),
  workflowId: text("workflow_id").notNull(),
  conflictingWorkflowId: text("conflicting_workflow_id").notNull(),
  conflictType: text("conflict_type").notNull(),
  // trigger_overlap | action_overlap | pipeline_overlap | recursive_loop | duplicate_email
  details: jsonb("details").default({}),
  resolution: text("resolution"),
  // view | clone | disable | continue | pending
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertWorkflowConflictSchema = createInsertSchema(workflowConflicts).omit({ id: true, createdAt: true });
export type WorkflowConflict = typeof workflowConflicts.$inferSelect;
export type InsertWorkflowConflict = z.infer<typeof insertWorkflowConflictSchema>;

// ─── Workflow Execution Logs ──────────────────────────────────────────────────

export const workflowExecutionLogs = pgTable("workflow_execution_logs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  workflowId: text("workflow_id").notNull(),
  orgId: text("org_id").notNull(),
  status: text("status").notNull().default("pending"),
  // pending | running | completed | failed | blocked
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  durationMs: integer("duration_ms"),
  triggerType: text("trigger_type"),
  actionCount: integer("action_count").notNull().default(0),
  approvalGatesHit: integer("approval_gates_hit").notNull().default(0),
  blockedReason: text("blocked_reason"),
  leadId: text("lead_id"),
  bookingId: text("booking_id"),
  dealId: text("deal_id"),
  gmailActionId: text("gmail_action_id"),
  estimatedRevenueInfluenced: integer("estimated_revenue_influenced").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertWorkflowExecutionLogSchema = createInsertSchema(workflowExecutionLogs).omit({ id: true, createdAt: true });
export type WorkflowExecutionLog = typeof workflowExecutionLogs.$inferSelect;
export type InsertWorkflowExecutionLog = z.infer<typeof insertWorkflowExecutionLogSchema>;

// ─── Org AI Workforce Settings ────────────────────────────────────────────────
// Persists every wizard selection from the AI Workforce Setup Wizard.
// One row per org. Written on wizard completion, read by workforce agents
// to determine enabled departments, governance mode, and selected integrations.
// Future use: goals + orgPreset will drive recommended workflows, agent
// prioritization, business intelligence, and onboarding personalization.

export const orgAiWorkforceSettings = pgTable("org_ai_workforce_settings", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull().unique(),

  // Goals selected in step 2 (leads, retention, scheduling, admin, etc.)
  // Future: drive recommended workflow priorities and agent focus areas
  goals: jsonb("goals").default([]),

  // Org type preset selected in step 3 (private_trainer, performance_facility, etc.)
  // Future: personalize onboarding prompts, report templates, and AI recommendations
  orgPreset: text("org_preset"),

  // Departments the operator chose to activate (communications, scheduling, etc.)
  // Runtime: used by isAgentEnabledForOrg to filter which agents appear active
  enabledDepartments: jsonb("enabled_departments").default([]),

  // Internal governance mode string (supervised | collaborative | autonomous)
  // Mirrors org_ai_governance_settings.default_autonomy_mode after being seeded
  governanceMode: text("governance_mode").notNull().default("collaborative"),

  // Integration types the operator indicated interest in (gmail, slack, etc.)
  // Currently informational — will drive integration setup prompts
  selectedIntegrations: jsonb("selected_integrations").default([]),

  // Template IDs the operator selected (tpl-onboarding, tpl-retention, etc.)
  selectedWorkflowTemplates: jsonb("selected_workflow_templates").default([]),

  // Completion state
  onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
  onboardingCompletedAt: timestamp("onboarding_completed_at"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertOrgAiWorkforceSettingsSchema = createInsertSchema(orgAiWorkforceSettings).omit({ id: true, createdAt: true, updatedAt: true });
export type OrgAiWorkforceSettings = typeof orgAiWorkforceSettings.$inferSelect;
export type InsertOrgAiWorkforceSettings = z.infer<typeof insertOrgAiWorkforceSettingsSchema>;

// ─── AI Workforce Audit Log ────────────────────────────────────────────────────
// Immutable record of every change made to workforce configuration.
// eventType: wizard_completed | governance_changed | departments_changed |
//            templates_changed | integrations_changed | settings_updated

export const orgAiWorkforceAuditLog = pgTable("org_ai_workforce_audit_log", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),
  eventType: text("event_type").notNull(),
  changedBy: text("changed_by"),
  oldValue: jsonb("old_value"),
  newValue: jsonb("new_value"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type OrgAiWorkforceAuditLog = typeof orgAiWorkforceAuditLog.$inferSelect;

// ─── AI Workforce Outcomes ─────────────────────────────────────────────────────
// Evidence-based record of every business outcome attributed to an AI agent.
// outcomeType: revenue_generated | revenue_recovered | revenue_protected |
//   appointment_booked | lead_recovered | client_retained | no_show_prevented |
//   hours_saved | task_automated | workflow_executed | opportunity_identified
export const orgAiWorkforceOutcomes = pgTable("org_ai_workforce_outcomes", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),
  agentId: text("agent_id").notNull(),
  outcomeType: text("outcome_type").notNull(),
  outcomeCategory: text("outcome_category").notNull(),
  value: doublePrecision("value").default(0),
  currencyValue: doublePrecision("currency_value").default(0),
  sourceRecordId: text("source_record_id"),
  sourceTable: text("source_table"),
  confidenceScore: doublePrecision("confidence_score").default(0.8),
  attributedAt: timestamp("attributed_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});
export type OrgAiWorkforceOutcome = typeof orgAiWorkforceOutcomes.$inferSelect;

// ─── AI Workforce Opportunities ────────────────────────────────────────────────
// Actionable opportunities identified by AI agents.
// status: open | in_progress | resolved | expired
export const orgAiOpportunities = pgTable("org_ai_opportunities", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),
  agentId: text("agent_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  category: text("category").notNull(),
  potentialValue: doublePrecision("potential_value").default(0),
  confidence: doublePrecision("confidence").default(0.8),
  status: text("status").notNull().default("open"),
  sourceData: jsonb("source_data"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type OrgAiOpportunity = typeof orgAiOpportunities.$inferSelect;

// ─── AI Learning Events ─────────────────────────────────────────────────────
// Immutable record of every learning signal the workforce accumulates.
// eventType: success | failure | missed_opportunity | recommendation_accepted |
//            recommendation_rejected | recommendation_deferred | workflow_outcome
export const orgAiLearningEvents = pgTable("org_ai_learning_events", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),
  agentId: text("agent_id"),
  workflowId: text("workflow_id"),
  eventType: text("event_type").notNull(),
  outcome: text("outcome"),
  score: doublePrecision("score").default(0),
  context: jsonb("context"),
  createdAt: timestamp("created_at").defaultNow(),
});
export type OrgAiLearningEvent = typeof orgAiLearningEvents.$inferSelect;

// ─── AI Workforce Memory ─────────────────────────────────────────────────────
// Long-term organizational memory for preventing repeated recommendations
// and building compounding intelligence.
// memoryType: recommendation | opportunity | decision | workflow_outcome
// outcome: accepted | rejected | deferred | resolved | expired
export const orgAiWorkforceMemory = pgTable("org_ai_workforce_memory", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),
  memoryType: text("memory_type").notNull(),
  key: text("key").notNull(),
  title: text("title").notNull(),
  summary: text("summary"),
  outcome: text("outcome"),
  value: doublePrecision("value").default(0),
  context: jsonb("context"),
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
});
export type OrgAiWorkforceMemory = typeof orgAiWorkforceMemory.$inferSelect;

// ─── Execution Plans ─────────────────────────────────────────────────────────
// Source of truth for every approved workforce action.
// executionStatus: draft | awaiting_approval | approved | executing | completed | failed | cancelled
// approvalStatus:  pending | approved | rejected | auto_approved
// riskLevel:       low | medium | high | critical
export const orgAiExecutionPlans = pgTable("org_ai_execution_plans", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),
  agentId: text("agent_id"),
  recommendationId: text("recommendation_id"),
  title: text("title").notNull(),
  executionType: text("execution_type").notNull(),
  executionStatus: text("execution_status").notNull().default("draft"),
  approvalStatus: text("approval_status").notNull().default("pending"),
  riskLevel: text("risk_level").notNull().default("low"),
  estimatedValue: doublePrecision("estimated_value").default(0),
  actualValue: doublePrecision("actual_value"),
  executionSteps: jsonb("execution_steps"),
  auditTrail: jsonb("audit_trail"),
  notes: text("notes"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});
export type OrgAiExecutionPlan = typeof orgAiExecutionPlans.$inferSelect;

// ─── Approval Rules ───────────────────────────────────────────────────────────
// Governs which agent actions can auto-execute vs require human approval.
export const orgAiApprovalRules = pgTable("org_ai_approval_rules", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),
  agentId: text("agent_id"),
  riskLevel: text("risk_level").notNull(),
  actionType: text("action_type"),
  requiresApproval: boolean("requires_approval").notNull().default(true),
  autoApprove: boolean("auto_approve").notNull().default(false),
  approvalThreshold: doublePrecision("approval_threshold").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type OrgAiApprovalRule = typeof orgAiApprovalRules.$inferSelect;

// ─── Experiments ─────────────────────────────────────────────────────────────
// A/B testing framework for workflows, messages, and cadences.
// status: running | completed | cancelled | pending
// winner: a | b | tie | inconclusive
export const orgAiExperiments = pgTable("org_ai_experiments", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  agentId: text("agent_id"),
  workflowId: text("workflow_id"),
  experimentType: text("experiment_type").notNull(),
  status: text("status").notNull().default("pending"),
  variantA: jsonb("variant_a"),
  variantB: jsonb("variant_b"),
  variantAMetrics: jsonb("variant_a_metrics"),
  variantBMetrics: jsonb("variant_b_metrics"),
  winner: text("winner"),
  confidence: doublePrecision("confidence").default(0),
  learningEvents: jsonb("learning_events"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});
export type OrgAiExperiment = typeof orgAiExperiments.$inferSelect;

// ─── Workflow Optimization Recommendations ────────────────────────────────────
// Suggestions to improve specific workflows. Human approval required before change.
export const workflowOptimizationRecs = pgTable("workflow_optimization_recs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),
  workflowId: text("workflow_id"),
  workflowName: text("workflow_name"),
  currentConversion: doublePrecision("current_conversion"),
  suggestedChange: text("suggested_change"),
  rationale: text("rationale"),
  expectedConversion: doublePrecision("expected_conversion"),
  confidence: doublePrecision("confidence").default(0),
  estimatedLift: doublePrecision("estimated_lift").default(0),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
});
export type WorkflowOptimizationRec = typeof workflowOptimizationRecs.$inferSelect;

// ─── Agent Templates (Marketplace Foundation) ────────────────────────────────
// Expanded Phase 6: full marketplace-ready profiles.
export const agentTemplates = pgTable("agent_templates", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  agentId: text("agent_id").notNull().unique(), // maps to AGENT_IDENTITIES key
  agentName: text("agent_name").notNull(),
  description: text("description"),
  department: text("department"),
  capabilities: jsonb("capabilities"),
  requiredIntegrations: jsonb("required_integrations"),
  supportedIndustries: jsonb("supported_industries"),
  benchmarkMetrics: jsonb("benchmark_metrics"),
  averageRoi: doublePrecision("average_roi").default(0),
  averageSuccessRate: doublePrecision("average_success_rate").default(0),
  averageHoursSaved: doublePrecision("average_hours_saved").default(0),
  averageTrustScore: doublePrecision("average_trust_score").default(0),
  averageRevenueInfluenced: doublePrecision("average_revenue_influenced").default(0),
  benchmarkScore: doublePrecision("benchmark_score").default(0),
  certificationLevel: text("certification_level").default("uncertified"),
  installationCount: integer("installation_count").default(0),
  version: text("version").default("1.0.0"),
  maintainer: text("maintainer").default("TrainEfficiency"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type AgentTemplate = typeof agentTemplates.$inferSelect;

// ─── Agent Benchmarks ──────────────────────────────────────────────────────────
// Rolling benchmark snapshots. Never stores org-identifying data.
export const agentBenchmarks = pgTable("agent_benchmarks", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  agentTemplateId: text("agent_template_id"),
  agentId: text("agent_id"),
  benchmarkType: text("benchmark_type").notNull(), // platform | industry | organization
  industry: text("industry"),
  sampleSize: integer("sample_size").default(0),
  successRate: doublePrecision("success_rate").default(0),
  revenueInfluence: doublePrecision("revenue_influence").default(0),
  hoursSaved: doublePrecision("hours_saved").default(0),
  roi: doublePrecision("roi").default(0),
  trustScore: doublePrecision("trust_score").default(0),
  forecastAccuracy: doublePrecision("forecast_accuracy").default(0),
  recommendationAccuracy: doublePrecision("recommendation_accuracy").default(0),
  opportunityConversion: doublePrecision("opportunity_conversion").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});
export type AgentBenchmark = typeof agentBenchmarks.$inferSelect;

// ─── Installed Agents ─────────────────────────────────────────────────────────
// Tracks agent installations per org with governance policy assignment.
export const orgInstalledAgents = pgTable("org_installed_agents", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),
  agentTemplateId: text("agent_template_id"),
  agentId: text("agent_id").notNull(),
  status: text("status").notNull().default("active"), // active | paused | uninstalled
  configuration: jsonb("configuration"),
  governancePolicy: jsonb("governance_policy"),
  performanceMetrics: jsonb("performance_metrics"),
  installedAt: timestamp("installed_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});
export type OrgInstalledAgent = typeof orgInstalledAgents.$inferSelect;

// ─── Agent Certifications ─────────────────────────────────────────────────────
// Certification levels: uncertified | certified | high_performer | elite_performer | platform_recommended
export const agentCertifications = pgTable("agent_certifications", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  agentTemplateId: text("agent_template_id"),
  agentId: text("agent_id").notNull(),
  certificationLevel: text("certification_level").notNull(),
  roiScore: doublePrecision("roi_score").default(0),
  trustScore: doublePrecision("trust_score").default(0),
  successRateScore: doublePrecision("success_rate_score").default(0),
  sampleSize: integer("sample_size").default(0),
  forecastAccuracyScore: doublePrecision("forecast_accuracy_score").default(0),
  opportunityConversionScore: doublePrecision("opportunity_conversion_score").default(0),
  achievedAt: timestamp("achieved_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
});
export type AgentCertification = typeof agentCertifications.$inferSelect;

// ─── Industry Benchmarks ──────────────────────────────────────────────────────
// Industry-level benchmarks anonymized across orgs by industry type.
export const industryBenchmarks = pgTable("industry_benchmarks", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  industry: text("industry").notNull(),
  metricName: text("metric_name").notNull(),
  metricValue: doublePrecision("metric_value").default(0),
  sampleSize: integer("sample_size").default(0),
  period: text("period").notNull().default("30d"),
  createdAt: timestamp("created_at").defaultNow(),
});
export type IndustryBenchmark = typeof industryBenchmarks.$inferSelect;

// ─── Agent Versions ───────────────────────────────────────────────────────────
// Version history with rollback support — prepares agents to become products.
export const agentVersions = pgTable("agent_versions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  agentTemplateId: text("agent_template_id"),
  agentId: text("agent_id").notNull(),
  version: text("version").notNull(),
  releaseNotes: text("release_notes"),
  benchmarkChanges: jsonb("benchmark_changes"),
  roiDelta: doublePrecision("roi_delta").default(0),
  trustDelta: doublePrecision("trust_delta").default(0),
  performanceChanges: jsonb("performance_changes"),
  status: text("status").notNull().default("stable"),
  createdAt: timestamp("created_at").defaultNow(),
});
export type AgentVersion = typeof agentVersions.$inferSelect;

// ─── Cross-Org Learning Events ────────────────────────────────────────────────
// Anonymized cross-org learning signals for benchmark improvement.
// No organization-specific data stored or exposed.
export const crossOrgLearningEvents = pgTable("cross_org_learning_events", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  agentId: text("agent_id"),
  eventType: text("event_type").notNull(),
  outcome: text("outcome"),
  score: doublePrecision("score").default(0),
  industry: text("industry"),
  benchmarkData: jsonb("benchmark_data"),
  patternTags: jsonb("pattern_tags"),
  createdAt: timestamp("created_at").defaultNow(),
});
export type CrossOrgLearningEvent = typeof crossOrgLearningEvents.$inferSelect;

// ─── Developer Accounts ───────────────────────────────────────────────────────
// Developer registration for agent builders. Linked to platform user or org.
export const developerAccounts = pgTable("developer_accounts", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id"),
  orgId: text("org_id"),
  displayName: text("display_name").notNull(),
  email: text("email"),
  bio: text("bio"),
  status: text("status").notNull().default("active"), // active | suspended | pending
  totalInstalls: integer("total_installs").default(0),
  totalRevenue: doublePrecision("total_revenue").default(0),
  lifetimeRevenue: doublePrecision("lifetime_revenue").default(0),
  agentsPublished: integer("agents_published").default(0),
  revenueShareRate: doublePrecision("revenue_share_rate").default(0.30),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type DeveloperAccount = typeof developerAccounts.$inferSelect;

// ─── Agent Submissions ────────────────────────────────────────────────────────
// Developer workflow: Draft → Submitted → Under Review → Approved → Rejected → Published
export const agentSubmissions = pgTable("agent_submissions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  developerId: text("developer_id").notNull(),
  agentTemplateId: text("agent_template_id"),
  agentDefinition: jsonb("agent_definition"),
  submissionStatus: text("submission_status").notNull().default("draft"),
  reviewNotes: text("review_notes"),
  benchmarkResults: jsonb("benchmark_results"),
  governanceReview: jsonb("governance_review"),
  submittedAt: timestamp("submitted_at"),
  reviewedAt: timestamp("reviewed_at"),
  approvedAt: timestamp("approved_at"),
  publishedAt: timestamp("published_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type AgentSubmission = typeof agentSubmissions.$inferSelect;

// ─── Agent Revenue Events ─────────────────────────────────────────────────────
// Tracks revenue generated per agent for developer royalty attribution.
export const agentRevenueEvents = pgTable("agent_revenue_events", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  developerId: text("developer_id"),
  agentId: text("agent_id").notNull(),
  orgId: text("org_id").notNull(),
  eventType: text("event_type").notNull(), // installation | usage | subscription | revenue_recovered
  amount: doublePrecision("amount").default(0),
  royaltyAmount: doublePrecision("royalty_amount").default(0),
  attribution: jsonb("attribution"),
  period: text("period"),
  createdAt: timestamp("created_at").defaultNow(),
});
export type AgentRevenueEvent = typeof agentRevenueEvents.$inferSelect;

// ─── Developer Payouts ────────────────────────────────────────────────────────
// Payout records — infrastructure only. No payment processing yet.
export const developerPayouts = pgTable("developer_payouts", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  developerId: text("developer_id").notNull(),
  amount: doublePrecision("amount").notNull().default(0),
  currency: text("currency").default("USD"),
  periodStart: timestamp("period_start"),
  periodEnd: timestamp("period_end"),
  status: text("status").notNull().default("pending"), // pending | processing | paid | failed
  breakdown: jsonb("breakdown"),
  createdAt: timestamp("created_at").defaultNow(),
});
export type DeveloperPayout = typeof developerPayouts.$inferSelect;

// ─── Agent Reviews ─────────────────────────────────────────────────────────────
// Org-submitted agent reviews — the Glassdoor layer.
export const agentReviews = pgTable("agent_reviews", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  agentId: text("agent_id").notNull(),
  orgId: text("org_id").notNull(),
  rating: doublePrecision("rating").notNull(), // 1.0–5.0
  review: text("review"),
  outcomeScore: doublePrecision("outcome_score").default(0), // 0–10
  trustScore: doublePrecision("trust_score").default(0),     // 0–10
  roiScore: doublePrecision("roi_score").default(0),         // 0–10
  easeOfUse: integer("ease_of_use").default(3),              // 1–5
  businessImpact: integer("business_impact").default(3),     // 1–5
  reliability: integer("reliability").default(3),            // 1–5
  verifiedUsage: boolean("verified_usage").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});
export type AgentReview = typeof agentReviews.$inferSelect;

// ─── Agent Permissions ────────────────────────────────────────────────────────
// Agents declare required permissions; orgs explicitly grant them.
export const agentPermissions = pgTable("agent_permissions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  agentId: text("agent_id").notNull(),
  orgId: text("org_id"),
  permissionType: text("permission_type").notNull(),
  // crm_access | email_access | calendar_access | billing_access | lead_access | reporting_access
  granted: boolean("granted").default(false),
  grantedAt: timestamp("granted_at"),
  riskLevel: text("risk_level").default("low"),
  requiresApproval: boolean("requires_approval").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});
export type AgentPermission = typeof agentPermissions.$inferSelect;

// ─── Agent Reputation ─────────────────────────────────────────────────────────
// Composite reputation score from all quality signals.
export const agentReputation = pgTable("agent_reputation", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  agentId: text("agent_id").notNull().unique(),
  reputationScore: doublePrecision("reputation_score").default(0), // 0–100
  marketplaceRank: integer("marketplace_rank").default(0),
  trustTier: text("trust_tier").default("New to Market"),
  recommendationScore: doublePrecision("recommendation_score").default(0),
  avgRating: doublePrecision("avg_rating").default(0),
  reviewCount: integer("review_count").default(0),
  roiContribution: doublePrecision("roi_contribution").default(0),
  trustContribution: doublePrecision("trust_contribution").default(0),
  certificationContribution: doublePrecision("certification_contribution").default(0),
  adoptionContribution: doublePrecision("adoption_contribution").default(0),
  benchmarkStabilityContribution: doublePrecision("benchmark_stability_contribution").default(0),
  computedAt: timestamp("computed_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});
export type AgentReputationRecord = typeof agentReputation.$inferSelect;

// ─── White Label Agents ───────────────────────────────────────────────────────
// Org-cloned private agents with custom branding and rules.
export const whiteLabelAgents = pgTable("white_label_agents", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),
  sourceAgentId: text("source_agent_id").notNull(),
  customName: text("custom_name").notNull(),
  customDescription: text("custom_description"),
  customCapabilities: jsonb("custom_capabilities"),
  customRules: jsonb("custom_rules"),
  branding: jsonb("branding"),
  status: text("status").notNull().default("active"),
  installCount: integer("install_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type WhiteLabelAgent = typeof whiteLabelAgents.$inferSelect;

// ─── Agent Lifecycle Events ───────────────────────────────────────────────────
// Tracks full lifecycle: installed | active | upgraded | deprecated | archived | removed
export const agentLifecycleEvents = pgTable("agent_lifecycle_events", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  agentId: text("agent_id").notNull(),
  orgId: text("org_id"),
  eventType: text("event_type").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  notes: text("notes"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});
export type AgentLifecycleEvent = typeof agentLifecycleEvents.$inferSelect;

// ─── Agent Runtimes ───────────────────────────────────────────────────────────
// Each installed agent receives its own isolated execution environment.
export const agentRuntimes = pgTable("agent_runtimes", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  agentId: text("agent_id").notNull(),
  orgId: text("org_id").notNull(),
  runtimeVersion: text("runtime_version").default("1.0.0"),
  memoryScope: jsonb("memory_scope"),          // Which memory namespaces are accessible
  toolScope: jsonb("tool_scope"),              // Which tools/integrations are permitted
  executionCount: integer("execution_count").default(0),
  successCount: integer("success_count").default(0),
  failureCount: integer("failure_count").default(0),
  status: text("status").notNull().default("active"), // active | paused | terminated
  lastActiveAt: timestamp("last_active_at"),
  isolationLevel: text("isolation_level").default("standard"), // standard | strict | sandbox
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type AgentRuntime = typeof agentRuntimes.$inferSelect;

// ─── Agent Memories ───────────────────────────────────────────────────────────
// Per-agent memory store — invisible to other agents, org-scoped.
export const agentMemories = pgTable("agent_memories", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  agentId: text("agent_id").notNull(),
  orgId: text("org_id").notNull(),
  learnedPreferences: jsonb("learned_preferences"),      // What this org prefers
  successfulPatterns: jsonb("successful_patterns"),      // What has worked
  failedPatterns: jsonb("failed_patterns"),              // What has failed
  orgSpecificContext: jsonb("org_specific_context"),     // Org-specific knowledge
  workflowHistory: jsonb("workflow_history"),            // Past executions summary
  recommendationHistory: jsonb("recommendation_history"),// Past recommendations made
  memoryVersion: integer("memory_version").default(1),
  lastUpdatedAt: timestamp("last_updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});
export type AgentMemory = typeof agentMemories.$inferSelect;

// ─── Developer Royalty Accounts ───────────────────────────────────────────────
export const developerRoyaltyAccounts = pgTable("developer_royalty_accounts", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  developerId: text("developer_id").notNull().unique(),
  balance: doublePrecision("balance").default(0),        // Current unpaid balance
  lifetimeEarned: doublePrecision("lifetime_earned").default(0),
  lifetimePaid: doublePrecision("lifetime_paid").default(0),
  pendingAmount: doublePrecision("pending_amount").default(0),
  nextPayoutDate: timestamp("next_payout_date"),
  payoutFrequency: text("payout_frequency").default("monthly"), // monthly | quarterly
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type DeveloperRoyaltyAccount = typeof developerRoyaltyAccounts.$inferSelect;

// ─── Royalty Distributions ────────────────────────────────────────────────────
export const royaltyDistributions = pgTable("royalty_distributions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  developerId: text("developer_id").notNull(),
  agentId: text("agent_id").notNull(),
  revenueSource: text("revenue_source").notNull(), // install | usage | subscription | revenue_recovered
  grossRevenue: doublePrecision("gross_revenue").default(0),
  platformShare: doublePrecision("platform_share").default(0),
  developerShare: doublePrecision("developer_share").default(0),
  platformShareRate: doublePrecision("platform_share_rate").default(0.70),
  developerShareRate: doublePrecision("developer_share_rate").default(0.30),
  payoutStatus: text("payout_status").default("pending"), // pending | processing | paid | cancelled
  period: text("period"),            // "2026-05"
  createdAt: timestamp("created_at").defaultNow(),
});
export type RoyaltyDistribution = typeof royaltyDistributions.$inferSelect;

// ─── Agent Verification Reviews ───────────────────────────────────────────────
// Before publication: Security → Governance → Performance → Benchmark → Permission
export const agentVerificationReviews = pgTable("agent_verification_reviews", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  agentId: text("agent_id").notNull(),
  securityReview: jsonb("security_review"),
  governanceReview: jsonb("governance_review"),
  performanceReview: jsonb("performance_review"),
  benchmarkReview: jsonb("benchmark_review"),
  permissionReview: jsonb("permission_review"),
  verificationLevel: text("verification_level").default("unverified"),
  // unverified | verified | secure | certified | enterprise_ready | platform_approved
  overallScore: doublePrecision("overall_score").default(0),
  reviewNotes: text("review_notes"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type AgentVerificationReview = typeof agentVerificationReviews.$inferSelect;

// ─── Agent Case Studies ───────────────────────────────────────────────────────
// Social proof — org outcomes documented per agent.
export const agentCaseStudies = pgTable("agent_case_studies", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  agentId: text("agent_id").notNull(),
  orgId: text("org_id").notNull(),
  orgType: text("org_type"),
  problem: text("problem").notNull(),
  solution: text("solution").notNull(),
  outcome: text("outcome").notNull(),
  revenueImpact: doublePrecision("revenue_impact").default(0),
  timeSaved: doublePrecision("time_saved").default(0),
  trustScore: doublePrecision("trust_score").default(0),
  verificationStatus: text("verification_status").default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
});
export type AgentCaseStudy = typeof agentCaseStudies.$inferSelect;

// ─── Agent Trials ─────────────────────────────────────────────────────────────
// 7/14/30-day trials before committing to install.
export const agentTrials = pgTable("agent_trials", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  agentId: text("agent_id").notNull(),
  orgId: text("org_id").notNull(),
  trialDurationDays: integer("trial_duration_days").default(14),
  trialStart: timestamp("trial_start").defaultNow(),
  trialEnd: timestamp("trial_end"),
  status: text("status").notNull().default("active"),
  // active | expired | converted | cancelled
  usageCount: integer("usage_count").default(0),
  roiGenerated: doublePrecision("roi_generated").default(0),
  converted: boolean("converted").default(false),
  convertedAt: timestamp("converted_at"),
  createdAt: timestamp("created_at").defaultNow(),
});
export type AgentTrial = typeof agentTrials.$inferSelect;

// ─── Agent Upgrade Paths ──────────────────────────────────────────────────────
// Controls how and when installed agents receive version upgrades.
export const agentUpgradePaths = pgTable("agent_upgrade_paths", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  agentId: text("agent_id").notNull(),
  orgId: text("org_id").notNull(),
  currentVersion: text("current_version").default("1.0.0"),
  availableVersion: text("available_version"),
  releaseChannel: text("release_channel").default("stable"), // stable | beta | experimental
  upgradeMode: text("upgrade_mode").default("manual_approval"), // auto | manual_approval
  autoUpgrade: boolean("auto_upgrade").default(false),
  lastUpgradedAt: timestamp("last_upgraded_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type AgentUpgradePath = typeof agentUpgradePaths.$inferSelect;

// ─── Phase 10: Beta Program Infrastructure ────────────────────────────────────

export const betaPrograms = pgTable("beta_programs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").default("active"),
  startDate: timestamp("start_date").defaultNow(),
  endDate: timestamp("end_date"),
  targetCoaches: integer("target_coaches").default(10),
  targetGymOwners: integer("target_gym_owners").default(10),
  targetFacilities: integer("target_facilities").default(10),
  targetConsultants: integer("target_consultants").default(5),
  targetDevelopers: integer("target_developers").default(5),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type BetaProgram = typeof betaPrograms.$inferSelect;

export const betaParticipants = pgTable("beta_participants", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  programId: text("program_id").notNull(),
  orgId: text("org_id"),
  name: text("name").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull(),
  organization: text("organization"),
  industry: text("industry"),
  status: text("status").default("active"),
  joinedAt: timestamp("joined_at").defaultNow(),
  agentsInstalled: integer("agents_installed").default(0),
  reviewsSubmitted: integer("reviews_submitted").default(0),
  feedbackScore: doublePrecision("feedback_score"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type BetaParticipant = typeof betaParticipants.$inferSelect;

export const betaFeedback = pgTable("beta_feedback", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  programId: text("program_id").notNull(),
  participantId: text("participant_id"),
  category: text("category").notNull(),
  rating: integer("rating"),
  feedback: text("feedback").notNull(),
  agentId: text("agent_id"),
  featureArea: text("feature_area"),
  resolved: boolean("resolved").default(false),
  resolution: text("resolution"),
  createdAt: timestamp("created_at").defaultNow(),
});
export type BetaFeedbackItem = typeof betaFeedback.$inferSelect;

export const betaInvites = pgTable("beta_invites", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  programId: text("program_id"),
  name: text("name").notNull(),
  email: text("email").notNull(),
  organization: text("organization"),
  industry: text("industry"),
  role: text("role").notNull(),
  inviteStatus: text("invite_status").default("pending"),
  activationStatus: text("activation_status").default("not_activated"),
  invitedAt: timestamp("invited_at").defaultNow(),
  acceptedAt: timestamp("accepted_at"),
  feedbackScore: doublePrecision("feedback_score"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type BetaInvite = typeof betaInvites.$inferSelect;

export const inAppFeedback = pgTable("in_app_feedback", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id"),
  userId: text("user_id"),
  category: text("category").notNull(),
  severity: text("severity").default("medium"),
  title: text("title").notNull(),
  description: text("description").notNull(),
  status: text("status").default("open"),
  resolution: text("resolution"),
  agentId: text("agent_id"),
  pageContext: text("page_context"),
  reporter: text("reporter"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type InAppFeedbackItem = typeof inAppFeedback.$inferSelect;

// ─── Agent Communication Outcomes ─────────────────────────────────────────────
// Tracks real-world outcomes for every sent AI communication.

export const agentCommunicationOutcomes = pgTable("agent_communication_outcomes", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),
  gmailActionId: text("gmail_action_id"),
  feedbackId: text("feedback_id"),
  communicationDomain: text("communication_domain").notNull().default("athlete_lead"),
  messageType: text("message_type"),
  recipientEmail: text("recipient_email"),
  recipientName: text("recipient_name"),
  leadId: text("lead_id"),
  prospectId: text("prospect_id"),
  dealId: text("deal_id"),
  applicantId: text("applicant_id"),
  sentAt: timestamp("sent_at"),
  openedAt: timestamp("opened_at"),
  repliedAt: timestamp("replied_at"),
  meetingBookedAt: timestamp("meeting_booked_at"),
  proposalRequestedAt: timestamp("proposal_requested_at"),
  proposalSentAt: timestamp("proposal_sent_at"),
  proposalAcceptedAt: timestamp("proposal_accepted_at"),
  contractSignedAt: timestamp("contract_signed_at"),
  hiredAt: timestamp("hired_at"),
  bookedSessionAt: timestamp("booked_session_at"),
  convertedAt: timestamp("converted_at"),
  lostAt: timestamp("lost_at"),
  outcomeStatus: text("outcome_status").notNull().default("sent"),
  revenueCents: integer("revenue_cents").default(0),
  outcomeSource: text("outcome_source").default("manual_update"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export const insertAgentCommunicationOutcomeSchema = createInsertSchema(agentCommunicationOutcomes).omit({ id: true, createdAt: true, updatedAt: true });
export type AgentCommunicationOutcome = typeof agentCommunicationOutcomes.$inferSelect;
export type InsertAgentCommunicationOutcome = z.infer<typeof insertAgentCommunicationOutcomeSchema>;

// ─── Agent Rule Effectiveness ─────────────────────────────────────────────────
// Tracks outcome-weighted performance of each learning rule.

export const agentRuleEffectiveness = pgTable("agent_rule_effectiveness", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),
  ruleId: text("rule_id").notNull(),
  communicationDomain: text("communication_domain").notNull().default("athlete_lead"),
  messageType: text("message_type"),
  timesApplied: integer("times_applied").default(0),
  sentCount: integer("sent_count").default(0),
  replyCount: integer("reply_count").default(0),
  meetingCount: integer("meeting_count").default(0),
  proposalCount: integer("proposal_count").default(0),
  conversionCount: integer("conversion_count").default(0),
  hiredCount: integer("hired_count").default(0),
  lostCount: integer("lost_count").default(0),
  revenueCents: integer("revenue_cents").default(0),
  effectivenessScore: doublePrecision("effectiveness_score").default(0),
  lastCalculatedAt: timestamp("last_calculated_at").defaultNow(),
});
export type AgentRuleEffectiveness = typeof agentRuleEffectiveness.$inferSelect;

// ─── Employment Applicants ─────────────────────────────────────────────────────
// Dedicated applicant table for the Employment communication domain.

export const employmentApplicants = pgTable("employment_applicants", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  roleAppliedFor: text("role_applied_for"),
  experienceLevel: text("experience_level"),
  certifications: text("certifications"),
  location: text("location"),
  source: text("source"),
  status: text("status").notNull().default("new"),
  notes: text("notes"),
  resumeUrl: text("resume_url"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export const insertEmploymentApplicantSchema = createInsertSchema(employmentApplicants).omit({ id: true, createdAt: true, updatedAt: true });
export type EmploymentApplicant = typeof employmentApplicants.$inferSelect;
export type InsertEmploymentApplicant = z.infer<typeof insertEmploymentApplicantSchema>;

// ─── CEO Heartbeat Runs ───────────────────────────────────────────────────────
// Tracks every CEO Heartbeat orchestration cycle.

export const ceoHeartbeatRuns = pgTable("ceo_heartbeat_runs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),
  triggeredBy: text("triggered_by").notNull().default("cron"), // cron | manual | api
  status: text("status").notNull().default("running"), // running | completed | failed | paused
  agentsCoordinated: integer("agents_coordinated").default(0),
  actionsEvaluated: integer("actions_evaluated").default(0),
  actionsAutoExecuted: integer("actions_auto_executed").default(0),
  actionsPendingApproval: integer("actions_pending_approval").default(0),
  prioritiesGenerated: integer("priorities_generated").default(0),
  errorsEncountered: integer("errors_encountered").default(0),
  durationMs: integer("duration_ms"),
  summaryJson: jsonb("summary_json"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});
export const insertCeoHeartbeatRunSchema = createInsertSchema(ceoHeartbeatRuns).omit({ id: true, startedAt: true });
export type CeoHeartbeatRun = typeof ceoHeartbeatRuns.$inferSelect;
export type InsertCeoHeartbeatRun = z.infer<typeof insertCeoHeartbeatRunSchema>;

// ─── Job Execution Locks ──────────────────────────────────────────────────────
// Per-job distributed locks preventing duplicate cron execution.

export const jobExecutionLocks = pgTable("job_execution_locks", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),
  jobName: text("job_name").notNull(),
  lockKey: text("lock_key").notNull().unique(),
  acquiredAt: timestamp("acquired_at").defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
  releasedAt: timestamp("released_at"),
  status: text("status").notNull().default("acquired"), // acquired | released | expired
});
export const insertJobExecutionLockSchema = createInsertSchema(jobExecutionLocks).omit({ id: true, acquiredAt: true });
export type JobExecutionLock = typeof jobExecutionLocks.$inferSelect;

// ─── Agent Operating Timeline ─────────────────────────────────────────────────
// Unified single table for every agent action, recommendation, outcome,
// approval, send, skip, error, and learning event across the entire platform.

export const agentOperatingTimeline = pgTable("agent_operating_timeline", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),
  heartbeatId: text("heartbeat_id"),
  agentName: text("agent_name").notNull(),
  systemName: text("system_name"),
  actionType: text("action_type").notNull(), // recommendation | draft_created | approval_required | email_sent | reply_detected | workflow_executed | booking_created | revenue_outcome | error | skipped_duplicate | auto_executed | learning_event | program_generated | heartbeat_cycle
  actionStatus: text("action_status").notNull().default("pending"), // pending | completed | failed | skipped | requires_approval | approved | rejected
  priority: integer("priority").default(50),
  communicationDomain: text("communication_domain"),
  relatedEntityType: text("related_entity_type"), // gmail_action | lead | prospect | booking | deal | applicant | workflow | program
  relatedEntityId: text("related_entity_id"),
  summary: text("summary"),
  decisionReason: text("decision_reason"),
  requiresApproval: boolean("requires_approval").default(false),
  approvalStatus: text("approval_status"), // pending | approved | rejected | auto_approved
  executedAt: timestamp("executed_at"),
  outcomeStatus: text("outcome_status"),
  errorMessage: text("error_message"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertAgentOperatingTimelineSchema = createInsertSchema(agentOperatingTimeline).omit({ id: true, createdAt: true });
export type AgentOperatingTimelineEntry = typeof agentOperatingTimeline.$inferSelect;
export type InsertAgentOperatingTimelineEntry = z.infer<typeof insertAgentOperatingTimelineSchema>;

// ─── Admin Action Audit Log ───────────────────────────────────────────────────
// Immutable record of every human admin action in the platform.

export const adminActionAuditLog = pgTable("admin_action_audit_log", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),
  adminUserId: text("admin_user_id").notNull(),
  adminEmail: text("admin_email"),
  actionType: text("action_type").notNull(), // approval | rejection | edit | send | autonomy_change | emergency_pause | workflow_publish | outcome_update | bulk_approve | heartbeat_trigger | settings_change
  targetTable: text("target_table"),
  targetId: text("target_id"),
  beforeState: jsonb("before_state"),
  afterState: jsonb("after_state"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertAdminActionAuditLogSchema = createInsertSchema(adminActionAuditLog).omit({ id: true, createdAt: true });
export type AdminActionAuditLogEntry = typeof adminActionAuditLog.$inferSelect;
export type InsertAdminActionAuditLogEntry = z.infer<typeof insertAdminActionAuditLogSchema>;

// ─── Persistent Athlete Intelligence Layer (PAIL) ────────────────────────────
// Long-term athlete memory that survives across programs, seasons, and coaches.

export const athleteMemoryProfiles = pgTable("athlete_memory_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  athleteUserId: varchar("athlete_user_id").notNull(),

  // Training Identity
  primarySport: varchar("primary_sport"),
  secondarySport: varchar("secondary_sport"),
  position: varchar("position"),
  competitionLevel: varchar("competition_level"),
  trainingAgeYears: integer("training_age_years"),

  // Athlete Preferences
  preferredExercises: jsonb("preferred_exercises").$type<string[]>().default([]),
  dislikedExercises: jsonb("disliked_exercises").$type<string[]>().default([]),
  preferredSessionLengthMin: integer("preferred_session_length_min"),
  preferredTrainingDays: jsonb("preferred_training_days").$type<string[]>().default([]),

  // Movement Intelligence
  movementRestrictions: jsonb("movement_restrictions").$type<string[]>().default([]),
  recurringCompensations: jsonb("recurring_compensations").$type<string[]>().default([]),
  technicalFocusAreas: jsonb("technical_focus_areas").$type<string[]>().default([]),
  coachingCuesThatWork: jsonb("coaching_cues_that_work").$type<string[]>().default([]),

  // Readiness Intelligence
  normalReadinessRange: jsonb("normal_readiness_range").$type<{ min: number; max: number; avg: number }>(),
  fatiguePatterns: text("fatigue_patterns"),
  recoveryPatterns: text("recovery_patterns"),
  stressPatterns: text("stress_patterns"),

  // Adaptation Intelligence
  exercisesThatProgressWell: jsonb("exercises_that_progress_well").$type<string[]>().default([]),
  exercisesThatStall: jsonb("exercises_that_stall").$type<string[]>().default([]),
  highResponseStimuli: jsonb("high_response_stimuli").$type<string[]>().default([]),
  lowResponseStimuli: jsonb("low_response_stimuli").$type<string[]>().default([]),

  // Injury Intelligence
  historicalInjuries: jsonb("historical_injuries").$type<Array<{ area: string; date?: string; severity?: string }>>().default([]),
  recurringPainAreas: jsonb("recurring_pain_areas").$type<string[]>().default([]),
  movementRedFlags: jsonb("movement_red_flags").$type<string[]>().default([]),

  // Coach Intelligence
  coachNotesSummary: text("coach_notes_summary"),
  coachingHistorySummary: text("coaching_history_summary"),
  lastCoachNoteAnalyzedAt: timestamp("last_coach_note_analyzed_at"),

  // Autonomy Trust Level (0 = manual review, 1 = suggest, 2 = auto low-risk, 3 = autonomous with monitoring)
  trustLevel: integer("trust_level").default(0),
  trustLevelReason: text("trust_level_reason"),

  // Learning Metadata
  memoryConfidence: integer("memory_confidence").default(0), // 0–100
  sessionsAnalyzed: integer("sessions_analyzed").default(0),
  lastSynthesizedAt: timestamp("last_synthesized_at"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAthleteMemoryProfileSchema = createInsertSchema(athleteMemoryProfiles).omit({ id: true, createdAt: true, updatedAt: true });
export type AthleteMemoryProfile = typeof athleteMemoryProfiles.$inferSelect;
export type InsertAthleteMemoryProfile = z.infer<typeof insertAthleteMemoryProfileSchema>;

// ─── Athlete Session Outcomes ────────────────────────────────────────────────
// One row per completed/attempted session. Links athlete → session → program.

export const athleteSessionOutcomes = pgTable("athlete_session_outcomes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  athleteUserId: varchar("athlete_user_id").notNull(),
  sessionId: varchar("session_id").notNull(),
  programId: varchar("program_id"),

  sessionCompleted: boolean("session_completed").default(false),
  sessionSkipped: boolean("session_skipped").default(false),
  sessionModified: boolean("session_modified").default(false),

  prAchieved: boolean("pr_achieved").default(false),
  exercisesWithPR: jsonb("exercises_with_pr").$type<string[]>().default([]),

  readinessChange: integer("readiness_change"),   // delta from previous session check-in
  sorenessChange: integer("soreness_change"),
  painChange: integer("pain_change"),
  complianceScore: integer("compliance_score"),   // 0–100 for this session

  rpeAvg: integer("rpe_avg"),
  exercisesCompleted: integer("exercises_completed").default(0),
  exercisesTotal: integer("exercises_total").default(0),

  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAthleteSessionOutcomeSchema = createInsertSchema(athleteSessionOutcomes).omit({ id: true, createdAt: true });
export type AthleteSessionOutcome = typeof athleteSessionOutcomes.$inferSelect;
export type InsertAthleteSessionOutcome = z.infer<typeof insertAthleteSessionOutcomeSchema>;

// ─── Exercise Effectiveness Scores ────────────────────────────────────────────
// Per-athlete per-exercise intelligence that drives future programming.

export const exerciseEffectivenessScores = pgTable("exercise_effectiveness_scores", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  athleteUserId: varchar("athlete_user_id").notNull(),
  exerciseName: varchar("exercise_name").notNull(),
  exerciseId: varchar("exercise_id"),

  timesUsed: integer("times_used").default(0),
  timesCompleted: integer("times_completed").default(0),
  completionRate: integer("completion_rate").default(0),     // 0–100
  progressionRate: integer("progression_rate").default(0),  // % sessions w/ load increase
  prRate: integer("pr_rate").default(0),                    // % sessions w/ PR
  sorenessRate: integer("soreness_rate").default(0),        // % sessions w/ soreness
  painRate: integer("pain_rate").default(0),                // % sessions w/ pain

  effectivenessScore: integer("effectiveness_score").default(50), // 0–100

  lastCalculatedAt: timestamp("last_calculated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertExerciseEffectivenessScoreSchema = createInsertSchema(exerciseEffectivenessScores).omit({ id: true, createdAt: true, updatedAt: true });
export type ExerciseEffectivenessScore = typeof exerciseEffectivenessScores.$inferSelect;
export type InsertExerciseEffectivenessScore = z.infer<typeof insertExerciseEffectivenessScoreSchema>;

// ── Stripe Webhook Events (idempotency + audit log) ───────────────────────────
export const stripeWebhookEvents = pgTable("stripe_webhook_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  stripeEventId: varchar("stripe_event_id").notNull().unique(),
  eventType: varchar("event_type").notNull(),
  livemode: boolean("livemode").notNull().default(false),
  processedStatus: varchar("processed_status").notNull().default("pending"),
  processingError: text("processing_error"),
  customerId: varchar("customer_id"),
  paymentIntentId: varchar("payment_intent_id"),
  subscriptionId: varchar("subscription_id"),
  orgId: varchar("org_id"),
  userId: varchar("user_id"),
  amountCents: integer("amount_cents"),
  metadata: jsonb("metadata"),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
  processedAt: timestamp("processed_at"),
});

export const insertStripeWebhookEventSchema = createInsertSchema(stripeWebhookEvents).omit({ id: true, receivedAt: true });
export type StripeWebhookEvent = typeof stripeWebhookEvents.$inferSelect;
export type InsertStripeWebhookEvent = z.infer<typeof insertStripeWebhookEventSchema>;

// ── Attendance Tracker ────────────────────────────────────────────────────────

export const attendancePrograms = pgTable("attendance_programs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  programId: varchar("program_id").notNull().unique(),
  description: text("description"),
  location: varchar("location"),
  startDate: varchar("start_date"),
  endDate: varchar("end_date"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAttendanceProgramSchema = createInsertSchema(attendancePrograms).omit({ id: true, createdAt: true, updatedAt: true });
export type AttendanceProgram = typeof attendancePrograms.$inferSelect;
export type InsertAttendanceProgram = z.infer<typeof insertAttendanceProgramSchema>;

export const attendanceProgramFields = pgTable("attendance_program_fields", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  programId: varchar("program_id").notNull(),
  fieldName: varchar("field_name").notNull(),
  label: varchar("label").notNull(),
  fieldType: varchar("field_type").notNull().default("text"),
  visibility: varchar("visibility").notNull().default("required"),
  displayOrder: integer("display_order").notNull().default(0),
  options: jsonb("options").default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAttendanceProgramFieldSchema = createInsertSchema(attendanceProgramFields).omit({ id: true, createdAt: true });
export type AttendanceProgramField = typeof attendanceProgramFields.$inferSelect;
export type InsertAttendanceProgramField = z.infer<typeof insertAttendanceProgramFieldSchema>;

export const attendanceRewardTiers = pgTable("attendance_reward_tiers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  programId: varchar("program_id").notNull(),
  visitCount: integer("visit_count").notNull(),
  rewardName: varchar("reward_name").notNull(),
  rewardDescription: text("reward_description"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAttendanceRewardTierSchema = createInsertSchema(attendanceRewardTiers).omit({ id: true, createdAt: true });
export type AttendanceRewardTier = typeof attendanceRewardTiers.$inferSelect;
export type InsertAttendanceRewardTier = z.infer<typeof insertAttendanceRewardTierSchema>;

export const attendanceQrCodes = pgTable("attendance_qr_codes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  programId: varchar("program_id").notNull().unique(),
  publicSlug: varchar("public_slug").notNull().unique(),
  qrCodeUrl: text("qr_code_url"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAttendanceQrCodeSchema = createInsertSchema(attendanceQrCodes).omit({ id: true, createdAt: true });
export type AttendanceQrCode = typeof attendanceQrCodes.$inferSelect;
export type InsertAttendanceQrCode = z.infer<typeof insertAttendanceQrCodeSchema>;

export const attendanceRecords = pgTable("attendance_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  programId: varchar("program_id").notNull(),
  athleteEmail: varchar("athlete_email").notNull(),
  athleteFirstName: varchar("athlete_first_name"),
  athleteLastName: varchar("athlete_last_name"),
  phone: varchar("phone"),
  sport: varchar("sport"),
  position: varchar("position"),
  school: varchar("school"),
  gradYear: varchar("grad_year"),
  team: varchar("team"),
  age: varchar("age"),
  extraFields: jsonb("extra_fields").default(sql`'{}'::jsonb`),
  visitNumber: integer("visit_number").notNull().default(1),
  leadId: varchar("lead_id"),
  ipAddress: varchar("ip_address"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAttendanceRecordSchema = createInsertSchema(attendanceRecords).omit({ id: true, createdAt: true });
export type AttendanceRecord = typeof attendanceRecords.$inferSelect;
export type InsertAttendanceRecord = z.infer<typeof insertAttendanceRecordSchema>;

export const attendanceRewardsEarned = pgTable("attendance_rewards_earned", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  programId: varchar("program_id").notNull(),
  tierId: varchar("tier_id").notNull(),
  athleteEmail: varchar("athlete_email").notNull(),
  visitCountAtEarned: integer("visit_count_at_earned").notNull(),
  notificationSentAt: timestamp("notification_sent_at"),
  redeemedAt: timestamp("redeemed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAttendanceRewardsEarnedSchema = createInsertSchema(attendanceRewardsEarned).omit({ id: true, createdAt: true });
export type AttendanceRewardsEarned = typeof attendanceRewardsEarned.$inferSelect;
export type InsertAttendanceRewardsEarned = z.infer<typeof insertAttendanceRewardsEarnedSchema>;

export const attendanceEmailHistory = pgTable("attendance_email_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  programId: varchar("program_id").notNull(),
  athleteEmail: varchar("athlete_email").notNull(),
  emailType: varchar("email_type").notNull(),
  subject: varchar("subject"),
  status: varchar("status").notNull().default("sent"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAttendanceEmailHistorySchema = createInsertSchema(attendanceEmailHistory).omit({ id: true, createdAt: true });
export type AttendanceEmailHistory = typeof attendanceEmailHistory.$inferSelect;
export type InsertAttendanceEmailHistory = z.infer<typeof insertAttendanceEmailHistorySchema>;

// ─── Org Email Notification Settings ─────────────────────────────────────────
// Controls which booking-related emails the platform sends for each org.

export const orgEmailNotificationSettings = pgTable("org_email_notification_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull().unique(),

  // Athlete (client) notification toggles
  athleteBookingConfirmation: boolean("athlete_booking_confirmation").notNull().default(true),
  athleteRecurringConfirmation: boolean("athlete_recurring_confirmation").notNull().default(true),
  athleteReschedule: boolean("athlete_reschedule").notNull().default(true),
  athleteCancellation: boolean("athlete_cancellation").notNull().default(true),
  athleteReminder: boolean("athlete_reminder").notNull().default(true),

  // Admin / coach notification toggles
  adminNewBooking: boolean("admin_new_booking").notNull().default(true),
  adminRecurringBooking: boolean("admin_recurring_booking").notNull().default(false),
  adminReschedule: boolean("admin_reschedule").notNull().default(true),
  adminCancellation: boolean("admin_cancellation").notNull().default(true),

  // Deduplication window in minutes (default 15)
  dedupWindowMinutes: integer("dedup_window_minutes").notNull().default(15),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertOrgEmailNotificationSettingsSchema = createInsertSchema(orgEmailNotificationSettings).omit({ id: true, createdAt: true, updatedAt: true });
export type OrgEmailNotificationSettings = typeof orgEmailNotificationSettings.$inferSelect;
export type InsertOrgEmailNotificationSettings = z.infer<typeof insertOrgEmailNotificationSettingsSchema>;

// ─── Software Improvement Tasks ───────────────────────────────────────────────
// Structured engineering tasks generated by the Software Improvement Agent.
// These are Codex-ready suggestions only — no automatic code execution.

export const softwareImprovementStatusEnum = pgEnum("software_improvement_status", [
  "detected",
  "triaged",
  "ready_for_codex",
  "sent_to_codex",
  "in_progress",
  "needs_review",
  "merged",
  "rejected",
  "archived",
  "github_issue_draft_requested",
  "github_issue_created",
]);

export const softwareImprovementTasks = pgTable("software_improvement_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  sourceAgent: varchar("source_agent").notNull(),
  sourceType: varchar("source_type").notNull(),
  sourceRefId: varchar("source_ref_id"),
  title: varchar("title", { length: 512 }).notNull(),
  problemSummary: text("problem_summary").notNull(),
  businessContext: text("business_context"),
  affectedArea: varchar("affected_area", { length: 256 }),
  suspectedFiles: text("suspected_files"),
  reproductionSteps: text("reproduction_steps"),
  expectedBehavior: text("expected_behavior"),
  constraints: text("constraints"),
  acceptanceChecks: text("acceptance_checks"),
  severity: varchar("severity", { length: 32 }).notNull().default("medium"),
  priority: integer("priority").notNull().default(50),
  status: softwareImprovementStatusEnum("status").notNull().default("detected"),
  codexPrompt: text("codex_prompt"),
  codexStatus: varchar("codex_status", { length: 64 }),
  codexBranch: varchar("codex_branch", { length: 256 }),
  codexPrUrl: varchar("codex_pr_url", { length: 512 }),
  githubIssueUrl: varchar("github_issue_url", { length: 512 }),
  githubApprovalQueueId: varchar("github_approval_queue_id", { length: 256 }),
  githubIssueDraft: jsonb("github_issue_draft"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const insertSoftwareImprovementTaskSchema = createInsertSchema(softwareImprovementTasks).omit({ id: true, createdAt: true, updatedAt: true });
export type SoftwareImprovementTask = typeof softwareImprovementTasks.$inferSelect;
export type InsertSoftwareImprovementTask = z.infer<typeof insertSoftwareImprovementTaskSchema>;

// ─── Agent Quality Scores ─────────────────────────────────────────────────────
// Computed per-agent trust metrics across rolling windows.
// communication_domain = 'all' means aggregate across all domains.
export const agentQualityScores = pgTable("agent_quality_scores", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),
  agentName: text("agent_name").notNull(),
  communicationDomain: text("communication_domain").notNull().default("all"),
  windowDays: integer("window_days").notNull(),          // 7 | 30 | 90

  // Raw counts
  totalActions: integer("total_actions").notNull().default(0),
  approvedCount: integer("approved_count").notNull().default(0),
  rejectedCount: integer("rejected_count").notNull().default(0),
  editedCount: integer("edited_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  overrideCount: integer("override_count").notNull().default(0),
  learningConversionCount: integer("learning_conversion_count").notNull().default(0),

  // Computed rates (0.0–1.0)
  approvalRate: doublePrecision("approval_rate"),
  rejectionRate: doublePrecision("rejection_rate"),
  editRate: doublePrecision("edit_rate"),
  failureRate: doublePrecision("failure_rate"),
  learningConversionRate: doublePrecision("learning_conversion_rate"),
  averageConfidence: doublePrecision("average_confidence"),

  // Score & tier
  qualityScore: doublePrecision("quality_score"),
  scoreDelta: doublePrecision("score_delta"),
  trustTier: text("trust_tier").notNull().default("training"), // training|assisted|trusted|high_trust|restricted
  rejectionSpike: boolean("rejection_spike").notNull().default(false),

  windowStart: timestamp("window_start"),
  computedAt: timestamp("computed_at").defaultNow(),
}, (t) => [
  uniqueIndex("agent_quality_scores_unique").on(t.orgId, t.agentName, t.communicationDomain, t.windowDays),
]);
export type AgentQualityScore = typeof agentQualityScores.$inferSelect;

// ─── Agent Trust Overrides ────────────────────────────────────────────────────
// Admin-set manual tier overrides that take precedence over computed tiers.
export const agentTrustOverrides = pgTable("agent_trust_overrides", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orgId: text("org_id").notNull(),
  agentName: text("agent_name").notNull(),
  communicationDomain: text("communication_domain").notNull().default("all"),
  overrideTier: text("override_tier").notNull(), // training|assisted|trusted|high_trust|restricted
  reason: text("reason"),
  overriddenBy: text("overridden_by"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  uniqueIndex("agent_trust_override_unique").on(t.orgId, t.agentName, t.communicationDomain),
]);
export type AgentTrustOverride = typeof agentTrustOverrides.$inferSelect;
