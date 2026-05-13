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

export const athleticPrograms = pgTable("athletic_programs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  name: varchar("name").notNull(),
  slug: varchar("slug").notNull(),
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
});

export type AgentToolCall = typeof agentToolCalls.$inferSelect;
export type InsertAgentToolCall = typeof agentToolCalls.$inferInsert;

// ─── Workflow Orchestration ────────────────────────────────────────────────────

export const workflowRuns = pgTable("workflow_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: varchar("org_id").notNull(),
  workflowType: varchar("workflow_type").notNull(),
  displayName: varchar("display_name").notNull(),
  status: varchar("status").default("pending").notNull(),
  currentStepIndex: integer("current_step_index").default(0).notNull(),
  totalSteps: integer("total_steps").default(0).notNull(),
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
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  cancelledAt: timestamp("cancelled_at"),
  nextCheckAt: timestamp("next_check_at"),
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
