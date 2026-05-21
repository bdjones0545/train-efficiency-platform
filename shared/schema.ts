import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, time, pgEnum, uniqueIndex, jsonb, doublePrecision, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export * from "./models/auth";
export * from "./models/chat";
import { users } from "./models/auth";

export const subscriptionStatusEnum = pgEnum("subscription_status", ["trialing", "active", "past_due", "canceled", "incomplete", "none"]);

export const organizations = pgTable("organizations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  slug: varchar("slug").notNull().unique(),
  logoUrl: text("logo_url"),
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
