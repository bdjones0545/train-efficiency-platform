import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, time, pgEnum, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export * from "./models/auth";
export * from "./models/chat";
import { users } from "./models/auth";

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
  websiteUrl: text("website_url"),
  instagramUrl: text("instagram_url"),
  facebookUrl: text("facebook_url"),
  stripeSecretKey: text("stripe_secret_key"),
  stripePublishableKey: text("stripe_publishable_key"),
  locations: text("locations").array().default(sql`'{}'::text[]`),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertOrganizationSchema = createInsertSchema(organizations).omit({ id: true, createdAt: true });
export type Organization = typeof organizations.$inferSelect;
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;

export const roleEnum = pgEnum("user_role", ["CLIENT", "COACH", "ADMIN"]);
export const bookingStatusEnum = pgEnum("booking_status", ["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW"]);
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
  isActive: boolean("is_active").default(true),
  payoutPercentage: integer("payout_percentage"),
  organizationId: varchar("organization_id"),
});

export const sessionTypeEnum = pgEnum("session_type", ["1_ON_1", "GROUP"]);

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

export const bookings = pgTable("bookings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull().references(() => users.id),
  coachId: varchar("coach_id").notNull().references(() => coachProfiles.id),
  serviceId: varchar("service_id").notNull().references(() => services.id),
  startAt: timestamp("start_at").notNull(),
  endAt: timestamp("end_at").notNull(),
  status: bookingStatusEnum("status").notNull().default("CONFIRMED"),
  notes: text("notes").default(""),
  location: text("location").default(""),
  maxParticipants: integer("max_participants"),
  groupDescription: text("group_description").default(""),
  ageRange: text("age_range").default(""),
  skillLevel: text("skill_level").default(""),
  recurringGroupId: varchar("recurring_group_id"),
  paymentMethod: paymentMethodEnum("payment_method"),
  teamQuoteProgramId: varchar("team_quote_program_id"),
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

export const athleticBookings = pgTable("athletic_bookings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
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
