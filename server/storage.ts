import {
  users,
  userProfiles,
  coachProfiles,
  services,
  availabilityBlocks,
  bookings,
  bookingParticipants,
  redemptions,
  athleticPrograms,
  athleticBookings,
  athleticHourSchedules,
  cashouts,
  walletTransactions,
  appSettings,
  locations,
  blockedTimes,
  waitlist,
  agentActionLog,
  agentActions,
  organizationMedia,
  communicationLogs,
  type CommunicationLog,
  type InsertCommunicationLog,
  type Waitlist,
  type InsertWaitlist,
  type AgentActionLog,
  type InsertAgentActionLog,
  type AgentAction,
  type InsertAgentAction,
  type UserProfile,
  type InsertUserProfile,
  type CoachProfile,
  type InsertCoachProfile,
  type Service,
  type InsertService,
  type AvailabilityBlock,
  type InsertAvailabilityBlock,
  type Booking,
  type InsertBooking,
  type BookingParticipant,
  type InsertBookingParticipant,
  type Redemption,
  type InsertRedemption,
  type AthleticProgram,
  type InsertAthleticProgram,
  type AthleticBooking,
  type InsertAthleticBooking,
  type AthleticHourSchedule,
  type InsertAthleticHourSchedule,
  type Cashout,
  type InsertCashout,
  type WalletTransaction,
  type InsertWalletTransaction,
  teamQuotes,
  type TeamQuote,
  type InsertTeamQuote,
  organizations,
  type Organization,
  type Location,
  type InsertLocation,
  type BlockedTime,
  type InsertBlockedTime,
  organizationSubscriptionPlans,
  type OrganizationSubscriptionPlan,
  type InsertOrganizationSubscriptionPlan,
  subscriptionSchedules,
  type SubscriptionSchedule,
  type InsertSubscriptionSchedule,
  userSubscriptions,
  type UserSubscription,
  type InsertUserSubscription,
  type OrganizationMedia,
  type InsertOrganizationMedia,
  userOrgPreferences,
  type UserOrgPreferences,
} from "@shared/schema";
import type { User } from "@shared/models/auth";
import { passwordResetTokens } from "@shared/models/auth";
import { db } from "./db";
import { eq, and, gte, lte, gt, lt, or, desc, sql, ilike, inArray, ne, isNull, isNotNull } from "drizzle-orm";
import { randomUUID } from "crypto";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserProfile(userId: string): Promise<UserProfile | undefined>;
  upsertUserProfile(profile: InsertUserProfile): Promise<UserProfile>;
  getAllUsersWithProfiles(): Promise<(User & { profile?: UserProfile })[]>;
  updateUser(id: string, data: { firstName?: string; lastName?: string; email?: string | null; phone?: string | null; smsOptIn?: boolean; smsOptInAt?: Date | null; smsOptOutAt?: Date | null; smsConsentSource?: string | null }): Promise<User | undefined>;
  updateUserSmsOptIn(userId: string, optIn: boolean, source?: string): Promise<User | undefined>;
  deleteUser(id: string): Promise<boolean>;
  getBookingsForUser(userId: string): Promise<(Booking & { service?: Service; coach?: CoachProfile & { user: User } })[]>;

  getCoachProfiles(): Promise<(CoachProfile & { user: User })[]>;
  getCoachProfile(id: string): Promise<(CoachProfile & { user: User }) | undefined>;
  getCoachProfileByUserId(userId: string): Promise<CoachProfile | undefined>;
  getCoachProfileByEmail(email: string): Promise<CoachProfile | undefined>;
  createCoachProfile(profile: InsertCoachProfile): Promise<CoachProfile>;
  updateCoachProfile(id: string, data: Partial<CoachProfile>): Promise<CoachProfile | undefined>;
  deleteCoachProfile(id: string): Promise<boolean>;

  getServices(): Promise<Service[]>;
  getServicesByOrganization(orgId: string): Promise<Service[]>;
  getService(id: string): Promise<Service | undefined>;
  createService(service: InsertService): Promise<Service>;
  updateService(id: string, data: Partial<Service>): Promise<Service | undefined>;
  deleteService(id: string): Promise<boolean>;

  getAvailabilityBlocks(coachId: string): Promise<AvailabilityBlock[]>;
  createAvailabilityBlock(block: InsertAvailabilityBlock): Promise<AvailabilityBlock>;
  deleteAvailabilityBlock(id: string): Promise<void>;

  getBookings(clientId: string): Promise<(Booking & { service?: Service; coach?: CoachProfile & { user: User } })[]>;
  getCoachBookings(coachId: string): Promise<(Booking & { service?: Service; client?: User })[]>;
  getCoachCompletedBookings(coachId: string): Promise<(Booking & { service?: Service; client?: User })[]>;
  getAllBookings(): Promise<(Booking & { service?: Service; client?: User })[]>;
  getBooking(id: string): Promise<Booking | undefined>;
  createBooking(booking: InsertBooking): Promise<Booking>;
  updateBookingStatus(id: string, status: string): Promise<Booking | undefined>;
  updateBooking(id: string, data: { serviceId?: string; startAt?: Date; endAt?: Date; notes?: string; groupDescription?: string; maxParticipants?: number | null; clientId?: string; recurringGroupId?: string; paymentMethod?: string | null; teamQuoteProgramId?: string | null; ageRange?: string; skillLevel?: string; sport?: string }): Promise<Booking | undefined>;
  deleteBooking(id: string): Promise<boolean>;
  deleteBookingsByClientAndCoach(clientId: string, coachId: string): Promise<number>;
  deleteBookingsByRecurringGroup(recurringGroupId: string, excludeCompleted?: boolean): Promise<number>;
  getOverlappingBookings(coachId: string, startAt: Date, endAt: Date, excludeId?: string): Promise<Booking[]>;

  getBookingParticipants(bookingId: string): Promise<(BookingParticipant & { user: User })[]>;
  addBookingParticipant(participant: InsertBookingParticipant): Promise<BookingParticipant>;
  removeBookingParticipant(bookingId: string, userId: string): Promise<void>;
  removeBookingParticipantById(participantId: string): Promise<void>;
  getOpenSemiPrivateSessions(organizationId?: string): Promise<(Booking & { service?: Service; coach?: CoachProfile & { user: User }; participantCount: number })[]>;

  getCoachRedemptions(coachId: string): Promise<Redemption[]>;
  getAllRedemptions(): Promise<Redemption[]>;
  createRedemption(redemption: InsertRedemption): Promise<Redemption>;
  getRedemptionByBookingId(bookingId: string): Promise<Redemption | undefined>;
  findOrCreateUserByName(firstName: string, lastName: string, organizationId?: string | null): Promise<User>;
  findOrCreateTeamUser(teamName: string, coachEmail: string, programId: string): Promise<User>;
  searchUsers(query: string): Promise<User[]>;
  searchClientsByOrg(query: string, orgId: string): Promise<User[]>;
  getUserByEmail(email: string): Promise<User | undefined>;
  hasUsedFreeSession(userId: string): Promise<boolean>;

  getAthleticPrograms(organizationId: string): Promise<AthleticProgram[]>;
  getAthleticProgramById(id: string): Promise<AthleticProgram | undefined>;
  getAthleticProgramBySlug(organizationId: string, slug: string): Promise<AthleticProgram | undefined>;
  createAthleticProgram(program: InsertAthleticProgram): Promise<AthleticProgram>;
  updateAthleticProgram(id: string, data: Partial<InsertAthleticProgram>): Promise<AthleticProgram | undefined>;
  deleteAthleticProgram(id: string): Promise<void>;

  getAthleticBookings(date: string, programId: string): Promise<AthleticBooking[]>;
  getAthleticBookingsInRange(startDate: string, endDate: string, programId: string): Promise<AthleticBooking[]>;
  createAthleticBooking(booking: InsertAthleticBooking): Promise<AthleticBooking>;
  deleteAthleticBooking(id: string): Promise<void>;
  countAthleticBookingsForSlot(date: string, timeSlot: string, programId: string): Promise<number>;

  getAthleticHourSchedules(programId: string): Promise<AthleticHourSchedule[]>;
  getAthleticHourScheduleById(id: string): Promise<AthleticHourSchedule | undefined>;
  createAthleticHourSchedule(schedule: InsertAthleticHourSchedule): Promise<AthleticHourSchedule>;
  updateAthleticHourSchedule(id: string, data: Partial<InsertAthleticHourSchedule>): Promise<AthleticHourSchedule | undefined>;
  deleteAthleticHourSchedule(id: string): Promise<void>;

  getCoachCashouts(coachId: string): Promise<Cashout[]>;
  getAllCashouts(): Promise<Cashout[]>;
  createCashout(cashout: InsertCashout): Promise<Cashout>;
  updateCashoutStatus(id: string, status: string): Promise<Cashout | undefined>;
  markRedemptionsSent(coachId: string): Promise<void>;

  getAllWalletTransactions(): Promise<(WalletTransaction & { user?: User; redemptionCoachName?: string; bookingLocation?: string })[]>;
  getAllUserBalances(): Promise<{ id: string; firstName: string | null; lastName: string | null; email: string | null; balanceCents: number }[]>;
  getUserIdsByOrganization(orgId: string): Promise<string[]>;
  getClientUsersWithEmailByOrg(orgId: string): Promise<{ id: string; firstName: string | null; lastName: string | null; email: string }[]>;
  getUserBalancesByOrganization(orgId: string): Promise<{ id: string; firstName: string | null; lastName: string | null; email: string | null; balanceCents: number }[]>;

  getUserBalance(userId: string): Promise<number>;
  creditWallet(userId: string, amountCents: number, description: string, stripeSessionId?: string): Promise<WalletTransaction>;
  debitWallet(userId: string, amountCents: number, description: string, sourceType?: string, sourceId?: string): Promise<WalletTransaction>;
  getWalletTransactions(userId: string): Promise<WalletTransaction[]>;
  updateRedemptionAmount(id: string, amountCents: number): Promise<Redemption | undefined>;
  updateUserStripeCustomerId(userId: string, stripeCustomerId: string): Promise<void>;
  getWalletTransactionByStripeSessionId(stripeSessionId: string): Promise<WalletTransaction | undefined>;
  updateLastSignIn(userId: string): Promise<void>;
  getInactiveUsersForReminder(sinceDays: number): Promise<User[]>;
  markReminderSent(userId: string): Promise<void>;

  getUpcomingBookingsForReminder(windowStartMs: number, windowEndMs: number): Promise<Booking[]>;
  markClientReminderSent(bookingId: string): Promise<void>;
  markCoachReminderSent(bookingId: string): Promise<void>;

  getLocationsByOrganization(orgId: string): Promise<Location[]>;
  getLocation(id: string): Promise<Location | undefined>;
  createLocation(location: InsertLocation): Promise<Location>;
  updateLocation(id: string, data: Partial<InsertLocation>): Promise<Location | undefined>;
  deleteLocation(id: string): Promise<boolean>;

  getBlockedTimesByCoach(coachId: string): Promise<BlockedTime[]>;
  getBlockedTimesByOrganization(orgId: string): Promise<BlockedTime[]>;
  createBlockedTime(blockedTime: InsertBlockedTime): Promise<BlockedTime>;
  deleteBlockedTime(id: string): Promise<boolean>;

  getBookingsByOrganization(orgId: string): Promise<(Booking & { service?: Service; client?: User; coach?: CoachProfile & { user: User } })[]>;
  getBookingsByDateRangeForOrg(orgId: string, start: Date, end: Date): Promise<(Booking & { service?: Service; client?: User; coach?: CoachProfile & { user: User } })[]>;
  findClientsWithNoBookingsSince(orgId: string, since: Date): Promise<{ id: string; firstName: string | null; lastName: string | null; email: string | null; lastBookingDate: string | null }[]>;
  getCoachUtilizationForOrg(orgId: string, start: Date, end: Date): Promise<{ coachId: string; coachName: string; bookedMinutes: number; availableMinutes: number; utilizationPct: number }[]>;

  getWaitlistByOrganization(orgId: string): Promise<(Waitlist & { client?: User })[]>;
  addToWaitlist(entry: InsertWaitlist): Promise<Waitlist>;
  removeFromWaitlist(id: string): Promise<boolean>;

  logAgentAction(entry: InsertAgentActionLog): Promise<AgentActionLog>;
  getAgentActionLog(orgId: string, limit?: number): Promise<AgentActionLog[]>;
  undoAgentAction(id: string): Promise<boolean>;

  createAgentAction(entry: InsertAgentAction): Promise<AgentAction>;
  getAgentActionById(id: string): Promise<AgentAction | undefined>;
  getAgentActions(orgId: string, opts?: { status?: string; clientId?: string; sinceDays?: number; limit?: number }): Promise<AgentAction[]>;
  updateAgentAction(id: string, data: Partial<AgentAction>): Promise<AgentAction | undefined>;

  getOrgAutomationLevel(orgId: string): Promise<number>;
  setOrgAutomationLevel(orgId: string, level: number): Promise<void>;

  createTeamQuote(quote: InsertTeamQuote): Promise<TeamQuote>;
  getTeamQuotes(coachId: string): Promise<TeamQuote[]>;
  getAllTeamQuotes(): Promise<TeamQuote[]>;
  updateTeamQuote(id: string, data: Partial<TeamQuote>): Promise<TeamQuote | undefined>;
  deleteTeamQuote(id: string): Promise<boolean>;
  getTeamQuoteByStripeInvoiceId(stripeInvoiceId: string): Promise<TeamQuote | undefined>;
  getActiveTeamContracts(coachId?: string): Promise<TeamQuote[]>;

  getSetting(key: string): Promise<string | undefined>;
  setSetting(key: string, value: string): Promise<void>;
  getAllSettings(): Promise<{ key: string; value: string }[]>;

  createPasswordResetToken(data: { email: string; userId?: string; coachProfileId?: string; tokenHash: string; expiresAt: Date }): Promise<void>;
  invalidatePriorResetTokens(email: string): Promise<void>;
  findValidResetToken(tokenHash: string): Promise<import("@shared/models/auth").PasswordResetToken | undefined>;
  markResetTokenUsed(id: string): Promise<void>;
  updateUserPassword(userId: string, passwordHash: string): Promise<void>;
  updateCoachProfilePassword(coachProfileId: string, passwordHash: string): Promise<void>;
  cleanupExpiredResetTokens(): Promise<void>;

  getAllOrganizations(): Promise<Organization[]>;
  getOrganizationBySlug(slug: string): Promise<Organization | undefined>;
  getOrganizationById(id: string): Promise<Organization | undefined>;
  getOrganizationByStripeCustomerId(customerId: string): Promise<Organization | undefined>;
  getOrganizationByStripeSubscriptionId(subscriptionId: string): Promise<Organization | undefined>;
  updateOrganization(id: string, data: Partial<Organization>): Promise<Organization | undefined>;
  deleteOrganization(id: string): Promise<boolean>;
  getCoachProfilesByOrganization(orgId: string): Promise<(CoachProfile & { user?: User })[]>;
  getOrganizationSubscriptionPlans(orgId: string): Promise<OrganizationSubscriptionPlan[]>;
  getOrganizationSubscriptionPlan(planId: string): Promise<OrganizationSubscriptionPlan | undefined>;
  createOrganizationSubscriptionPlan(data: InsertOrganizationSubscriptionPlan): Promise<OrganizationSubscriptionPlan>;
  deleteOrganizationSubscriptionPlan(id: string): Promise<boolean>;
  deleteOrganizationSubscriptionPlansByOrg(orgId: string): Promise<void>;
  getSubscriptionSchedules(orgId: string): Promise<SubscriptionSchedule[]>;
  getSubscriptionSchedule(id: string): Promise<SubscriptionSchedule | undefined>;
  createSubscriptionSchedule(data: InsertSubscriptionSchedule): Promise<SubscriptionSchedule>;
  deleteSubscriptionSchedule(id: string): Promise<boolean>;
  getUserSubscriptions(userId: string): Promise<UserSubscription[]>;
  getUserSubscriptionByPlan(userId: string, planId: string): Promise<UserSubscription | undefined>;
  getUserSubscriptionByStripeId(stripeSubscriptionId: string): Promise<UserSubscription | undefined>;
  getUserSubscriptionByCheckoutSession(sessionId: string): Promise<UserSubscription | undefined>;
  createUserSubscription(data: InsertUserSubscription): Promise<UserSubscription>;
  updateUserSubscription(id: string, data: Partial<UserSubscription>): Promise<UserSubscription | undefined>;
  getOrganizationUserSubscriptions(orgId: string): Promise<UserSubscription[]>;

  getOrgMedia(orgId: string): Promise<OrganizationMedia[]>;
  getOrgMediaBySection(orgId: string, section: string): Promise<OrganizationMedia[]>;
  getPublicOrgMedia(orgId: string): Promise<OrganizationMedia[]>;
  createOrgMedia(data: InsertOrganizationMedia): Promise<OrganizationMedia>;
  updateOrgMedia(id: string, data: Partial<OrganizationMedia>): Promise<OrganizationMedia | undefined>;
  deleteOrgMedia(id: string): Promise<boolean>;
  reorderOrgMedia(updates: { id: string; orderIndex: number }[]): Promise<void>;
  getOrgMediaById(id: string): Promise<OrganizationMedia | undefined>;

  createCommunicationLog(data: InsertCommunicationLog): Promise<CommunicationLog>;
  getCommunicationsByOrg(orgId: string, limit?: number): Promise<CommunicationLog[]>;
  getCommunicationsByUser(userId: string): Promise<CommunicationLog[]>;
  getCommunicationsByBooking(bookingId: string): Promise<CommunicationLog[]>;

  getUserByUnsubscribeToken(token: string): Promise<User | undefined>;
  ensureUnsubscribeToken(userId: string): Promise<string>;
  updateNotificationPreferences(userId: string, prefs: Record<string, any>): Promise<User | undefined>;
  updateUserSmsOptIn(userId: string, optIn: boolean, source?: string): Promise<User | undefined>;

  // Team Training Prospecting
  getTeamTrainingProspects(orgId: string, opts?: { sport?: string; outreachStatus?: string; city?: string }): Promise<import("@shared/schema").TeamTrainingProspect[]>;
  getTeamTrainingProspect(id: string): Promise<import("@shared/schema").TeamTrainingProspect | undefined>;
  createTeamTrainingProspect(data: import("@shared/schema").InsertTeamTrainingProspect): Promise<import("@shared/schema").TeamTrainingProspect>;
  updateTeamTrainingProspect(id: string, data: Partial<import("@shared/schema").TeamTrainingProspect>): Promise<import("@shared/schema").TeamTrainingProspect | undefined>;
  deleteTeamTrainingProspect(id: string): Promise<boolean>;
  getOutreachDraftsByProspect(prospectId: string): Promise<import("@shared/schema").TeamTrainingOutreachDraft[]>;
  getOutreachDraft(id: string): Promise<import("@shared/schema").TeamTrainingOutreachDraft | undefined>;
  createOutreachDraft(data: import("@shared/schema").InsertTeamTrainingOutreachDraft): Promise<import("@shared/schema").TeamTrainingOutreachDraft>;
  updateOutreachDraft(id: string, data: Partial<import("@shared/schema").TeamTrainingOutreachDraft>): Promise<import("@shared/schema").TeamTrainingOutreachDraft | undefined>;
  logOutreachEvent(data: import("@shared/schema").InsertTeamTrainingOutreachEvent): Promise<import("@shared/schema").TeamTrainingOutreachEvent>;
  getOutreachEvents(orgId: string, prospectId?: string): Promise<import("@shared/schema").TeamTrainingOutreachEvent[]>;
  isProspectOptedOut(orgId: string, email: string): Promise<boolean>;
  addProspectOptOut(orgId: string, email: string, reason?: string): Promise<void>;
  getProspectDashboardStats(orgId: string): Promise<{ newLeads: number; pendingApproval: number; sentThisWeek: number; replies: number }>;
  getOutreachDraftsByOrg(orgId: string): Promise<(import("@shared/schema").TeamTrainingOutreachDraft & { prospect?: import("@shared/schema").TeamTrainingProspect })[]>;
  getEmailPerformanceStats(orgId: string): Promise<{ sent: number; opened: number; clicked: number; replied: number; openRate: number; clickRate: number; replyRate: number; conversionRate: number; bestVariant: import("@shared/schema").EmailMessageVariant | null }>;
  getEmailMessageVariants(orgId: string): Promise<import("@shared/schema").EmailMessageVariant[]>;
  createEmailMessageVariant(data: import("@shared/schema").InsertEmailMessageVariant): Promise<import("@shared/schema").EmailMessageVariant>;
  updateEmailMessageVariant(id: string, data: Partial<import("@shared/schema").EmailMessageVariant>): Promise<import("@shared/schema").EmailMessageVariant | undefined>;
  getEmailMessageVariant(id: string): Promise<import("@shared/schema").EmailMessageVariant | undefined>;
  deleteEmailMessageVariant(id: string): Promise<boolean>;
  selectVariantForEmail(orgId: string): Promise<import("@shared/schema").EmailMessageVariant | null>;
  runVariantOptimization(orgId: string): Promise<void>;

  // Follow-ups
  createFollowUp(data: import("@shared/schema").InsertEmailFollowUp): Promise<import("@shared/schema").EmailFollowUp>;
  getFollowUpsByOrg(orgId: string): Promise<(import("@shared/schema").EmailFollowUp & { prospect?: import("@shared/schema").TeamTrainingProspect })[]>;
  getFollowUpsByDraft(outreachDraftId: string): Promise<import("@shared/schema").EmailFollowUp[]>;
  getFollowUp(id: string): Promise<import("@shared/schema").EmailFollowUp | undefined>;
  updateFollowUp(id: string, data: Partial<import("@shared/schema").EmailFollowUp>): Promise<import("@shared/schema").EmailFollowUp | undefined>;
  getDueFollowUps(orgId: string): Promise<import("@shared/schema").EmailFollowUp[]>;
  cancelFollowUpSequence(outreachDraftId: string): Promise<void>;
  getFollowUpStats(orgId: string): Promise<{ activeSequences: number; pendingReplies: number; interestedLeads: number }>;

  // Team Training Deals
  getTeamTrainingDeals(orgId: string): Promise<(import("@shared/schema").TeamTrainingDeal & { prospect?: import("@shared/schema").TeamTrainingProspect })[]>;
  getTeamTrainingDeal(id: string): Promise<import("@shared/schema").TeamTrainingDeal | undefined>;
  getTeamTrainingDealByProspect(prospectId: string, orgId: string): Promise<import("@shared/schema").TeamTrainingDeal | undefined>;
  createTeamTrainingDeal(data: import("@shared/schema").InsertTeamTrainingDeal): Promise<import("@shared/schema").TeamTrainingDeal>;
  updateTeamTrainingDeal(id: string, data: Partial<import("@shared/schema").TeamTrainingDeal>): Promise<import("@shared/schema").TeamTrainingDeal | undefined>;
  deleteTeamTrainingDeal(id: string): Promise<boolean>;
  getDealPipelineStats(orgId: string): Promise<{ active: number; interested: number; negotiating: number; projectedRevenue: number; wonRevenue: number }>;

  // Per-org preferences
  getOrgContextForUser(userId: string): Promise<{ orgId: string; source: string } | null>;
  getUserOrgPreferences(userId: string, orgId: string): Promise<UserOrgPreferences | undefined>;
  upsertUserOrgPreferences(userId: string, orgId: string, data: {
    smsOptIn?: boolean;
    smsOptInAt?: Date | null;
    smsOptOutAt?: Date | null;
    notificationPreferences?: Record<string, any> | null;
  }): Promise<UserOrgPreferences>;
  ensureUserOrgPreferences(userId: string, orgId: string): Promise<UserOrgPreferences>;
  backfillUserOrgPreferences(): Promise<{ created: number; skipped: number }>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserProfile(userId: string): Promise<UserProfile | undefined> {
    const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId));
    return profile || undefined;
  }

  async upsertUserProfile(profile: InsertUserProfile): Promise<UserProfile> {
    const [existing] = await db.select().from(userProfiles).where(eq(userProfiles.userId, profile.userId));
    if (existing) {
      const updateData: any = {};
      if (profile.role !== undefined) {
        updateData.role = profile.role;
      }
      if (profile.organizationId !== undefined) {
        updateData.organizationId = profile.organizationId;
      }
      if (Object.keys(updateData).length === 0) return existing;
      const [updated] = await db.update(userProfiles).set(updateData).where(eq(userProfiles.userId, profile.userId)).returning();
      return updated;
    }
    const [created] = await db.insert(userProfiles).values(profile).returning();
    return created;
  }

  async getAllUsersWithProfiles(): Promise<(User & { profile?: UserProfile })[]> {
    const allUsers = await db.select().from(users);
    const allProfiles = await db.select().from(userProfiles);
    const profileMap = new Map(allProfiles.map(p => [p.userId, p]));
    return allUsers.map(u => ({ ...u, profile: profileMap.get(u.id) }));
  }

  async updateUser(id: string, data: { firstName?: string; lastName?: string; email?: string | null; phone?: string | null; smsOptIn?: boolean; smsOptInAt?: Date | null; smsOptOutAt?: Date | null; smsConsentSource?: string | null }): Promise<User | undefined> {
    const setData: any = {};
    if (data.firstName !== undefined) setData.firstName = data.firstName;
    if (data.lastName !== undefined) setData.lastName = data.lastName;
    if (data.email !== undefined) setData.email = data.email;
    if (data.phone !== undefined) setData.phone = data.phone;
    if (data.smsOptIn !== undefined) setData.smsOptIn = data.smsOptIn;
    if (data.smsOptInAt !== undefined) setData.smsOptInAt = data.smsOptInAt;
    if (data.smsOptOutAt !== undefined) setData.smsOptOutAt = data.smsOptOutAt;
    if (data.smsConsentSource !== undefined) setData.smsConsentSource = data.smsConsentSource;
    if (Object.keys(setData).length === 0) return this.getUser(id);
    const [updated] = await db.update(users).set(setData).where(eq(users.id, id)).returning();
    return updated;
  }

  async updateUserSmsOptIn(userId: string, optIn: boolean, source?: string): Promise<User | undefined> {
    const now = new Date();
    const setData: any = { smsOptIn: optIn };
    if (optIn) {
      setData.smsOptInAt = now;
      setData.smsOptOutAt = null;
    } else {
      setData.smsOptOutAt = now;
    }
    if (source) setData.smsConsentSource = source;
    const [updated] = await db.update(users).set(setData).where(eq(users.id, userId)).returning();
    return updated || undefined;
  }

  async deleteUser(id: string): Promise<boolean> {
    await db.delete(bookingParticipants).where(eq(bookingParticipants.userId, id));
    await db.delete(walletTransactions).where(eq(walletTransactions.userId, id));
    await db.delete(userProfiles).where(eq(userProfiles.userId, id));
    const userBookings = await db.select({ id: bookings.id }).from(bookings).where(eq(bookings.clientId, id));
    for (const b of userBookings) {
      await db.delete(bookingParticipants).where(eq(bookingParticipants.bookingId, b.id));
      await db.delete(redemptions).where(eq(redemptions.bookingId, b.id));
    }
    await db.delete(bookings).where(eq(bookings.clientId, id));
    const result = await db.delete(users).where(eq(users.id, id)).returning();
    return result.length > 0;
  }

  async getBookingsForUser(userId: string): Promise<(Booking & { service?: Service; coach?: CoachProfile & { user: User } })[]> {
    const result = await db
      .select()
      .from(bookings)
      .leftJoin(services, eq(bookings.serviceId, services.id))
      .leftJoin(coachProfiles, eq(bookings.coachId, coachProfiles.id))
      .leftJoin(users, eq(coachProfiles.userId, users.id))
      .where(eq(bookings.clientId, userId))
      .orderBy(desc(bookings.startAt));
    return result.map(r => ({
      ...r.bookings,
      service: r.services || undefined,
      coach: r.coach_profiles ? { ...r.coach_profiles, user: r.users! } : undefined,
    }));
  }

  async getCoachProfiles(): Promise<(CoachProfile & { user: User })[]> {
    const result = await db
      .select()
      .from(coachProfiles)
      .innerJoin(users, eq(coachProfiles.userId, users.id))
      .where(eq(coachProfiles.isActive, true));
    return result.map(r => ({ ...r.coach_profiles, user: r.users }));
  }

  async getCoachProfile(id: string): Promise<(CoachProfile & { user: User }) | undefined> {
    const [result] = await db
      .select()
      .from(coachProfiles)
      .innerJoin(users, eq(coachProfiles.userId, users.id))
      .where(eq(coachProfiles.id, id));
    if (!result) return undefined;
    return { ...result.coach_profiles, user: result.users };
  }

  async getCoachProfileByUserId(userId: string): Promise<CoachProfile | undefined> {
    const [result] = await db.select().from(coachProfiles).where(eq(coachProfiles.userId, userId));
    return result || undefined;
  }

  async getCoachProfileByEmail(email: string): Promise<CoachProfile | undefined> {
    const [result] = await db.select().from(coachProfiles).where(eq(coachProfiles.email, email.toLowerCase()));
    return result || undefined;
  }

  async createCoachProfile(profile: InsertCoachProfile): Promise<CoachProfile> {
    const [created] = await db.insert(coachProfiles).values(profile).returning();
    return created;
  }

  async updateCoachProfile(id: string, data: Partial<CoachProfile>): Promise<CoachProfile | undefined> {
    const [updated] = await db.update(coachProfiles).set(data).where(eq(coachProfiles.id, id)).returning();
    return updated;
  }

  async deleteCoachProfile(id: string): Promise<boolean> {
    const profile = await this.getCoachProfile(id);
    if (!profile) return false;
    await db.delete(availabilityBlocks).where(eq(availabilityBlocks.coachId, id));
    const coachBookings = await db.select({ id: bookings.id }).from(bookings).where(eq(bookings.coachId, id));
    for (const b of coachBookings) {
      await db.delete(bookingParticipants).where(eq(bookingParticipants.bookingId, b.id));
      await db.delete(redemptions).where(eq(redemptions.bookingId, b.id));
    }
    await db.delete(redemptions).where(eq(redemptions.coachId, id));
    await db.delete(cashouts).where(eq(cashouts.coachId, id));
    await db.delete(bookings).where(eq(bookings.coachId, id));
    await db.delete(coachProfiles).where(eq(coachProfiles.id, id));
    return true;
  }

  async getServices(): Promise<Service[]> {
    return db.select().from(services);
  }

  async getServicesByOrganization(orgId: string): Promise<Service[]> {
    return db.select().from(services).where(eq(services.organizationId, orgId));
  }

  async getService(id: string): Promise<Service | undefined> {
    const [result] = await db.select().from(services).where(eq(services.id, id));
    return result || undefined;
  }

  async createService(service: InsertService): Promise<Service> {
    const [created] = await db.insert(services).values(service).returning();
    return created;
  }

  async updateService(id: string, data: Partial<Service>): Promise<Service | undefined> {
    const [updated] = await db.update(services).set(data).where(eq(services.id, id)).returning();
    return updated;
  }

  async deleteService(id: string): Promise<boolean> {
    const existingBookings = await db.select({ id: bookings.id }).from(bookings).where(eq(bookings.serviceId, id)).limit(1);
    if (existingBookings.length > 0) {
      throw new Error("Cannot delete a training option that has existing bookings. Deactivate it instead.");
    }
    const result = await db.delete(services).where(eq(services.id, id)).returning();
    return result.length > 0;
  }

  async getAvailabilityBlocks(coachId: string): Promise<AvailabilityBlock[]> {
    return db.select().from(availabilityBlocks).where(eq(availabilityBlocks.coachId, coachId));
  }

  async createAvailabilityBlock(block: InsertAvailabilityBlock): Promise<AvailabilityBlock> {
    const [created] = await db.insert(availabilityBlocks).values(block).returning();
    return created;
  }

  async deleteAvailabilityBlock(id: string): Promise<void> {
    await db.delete(availabilityBlocks).where(eq(availabilityBlocks.id, id));
  }

  async getBookings(clientId: string): Promise<(Booking & { service?: Service; coach?: CoachProfile & { user: User } })[]> {
    const result = await db
      .select()
      .from(bookings)
      .leftJoin(services, eq(bookings.serviceId, services.id))
      .leftJoin(coachProfiles, eq(bookings.coachId, coachProfiles.id))
      .leftJoin(users, eq(coachProfiles.userId, users.id))
      .where(eq(bookings.clientId, clientId))
      .orderBy(desc(bookings.startAt));
    return result.map(r => ({
      ...r.bookings,
      service: r.services || undefined,
      coach: r.coach_profiles ? { ...r.coach_profiles, user: r.users! } : undefined,
    }));
  }

  async getCoachBookings(coachId: string): Promise<(Booking & { service?: Service; client?: User })[]> {
    const result = await db
      .select()
      .from(bookings)
      .leftJoin(services, eq(bookings.serviceId, services.id))
      .leftJoin(users, eq(bookings.clientId, users.id))
      .where(eq(bookings.coachId, coachId))
      .orderBy(desc(bookings.startAt));
    return result.map(r => ({
      ...r.bookings,
      service: r.services || undefined,
      client: r.users || undefined,
    }));
  }

  async getCoachCompletedBookings(coachId: string): Promise<(Booking & { service?: Service; client?: User })[]> {
    const result = await db
      .select()
      .from(bookings)
      .leftJoin(services, eq(bookings.serviceId, services.id))
      .leftJoin(users, eq(bookings.clientId, users.id))
      .where(and(eq(bookings.coachId, coachId), eq(bookings.status, "COMPLETED")))
      .orderBy(desc(bookings.startAt));
    return result.map(r => ({
      ...r.bookings,
      service: r.services || undefined,
      client: r.users || undefined,
    }));
  }

  async getAllBookings(): Promise<(Booking & { service?: Service; client?: User })[]> {
    const result = await db
      .select()
      .from(bookings)
      .leftJoin(services, eq(bookings.serviceId, services.id))
      .leftJoin(users, eq(bookings.clientId, users.id))
      .orderBy(desc(bookings.startAt));
    return result.map(r => ({
      ...r.bookings,
      service: r.services || undefined,
      client: r.users || undefined,
    }));
  }

  async getBooking(id: string): Promise<Booking | undefined> {
    const [result] = await db.select().from(bookings).where(eq(bookings.id, id));
    return result || undefined;
  }

  async createBooking(booking: InsertBooking): Promise<Booking> {
    const [created] = await db.insert(bookings).values(booking).returning();
    return created;
  }

  async updateBookingStatus(id: string, status: string): Promise<Booking | undefined> {
    const [updated] = await db
      .update(bookings)
      .set({ status: status as any })
      .where(eq(bookings.id, id))
      .returning();
    return updated;
  }

  async updateBooking(id: string, data: { serviceId?: string; startAt?: Date; endAt?: Date; notes?: string; groupDescription?: string; maxParticipants?: number | null; clientId?: string; recurringGroupId?: string; paymentMethod?: string | null; teamQuoteProgramId?: string | null; ageRange?: string; skillLevel?: string; sport?: string }): Promise<Booking | undefined> {
    const setData: any = {};
    if (data.serviceId !== undefined) setData.serviceId = data.serviceId;
    if (data.startAt !== undefined) setData.startAt = data.startAt;
    if (data.endAt !== undefined) setData.endAt = data.endAt;
    if (data.notes !== undefined) setData.notes = data.notes;
    if (data.groupDescription !== undefined) setData.groupDescription = data.groupDescription;
    if (data.maxParticipants !== undefined) setData.maxParticipants = data.maxParticipants;
    if (data.clientId !== undefined) setData.clientId = data.clientId;
    if (data.recurringGroupId !== undefined) setData.recurringGroupId = data.recurringGroupId;
    if (data.paymentMethod !== undefined) setData.paymentMethod = data.paymentMethod;
    if (data.teamQuoteProgramId !== undefined) setData.teamQuoteProgramId = data.teamQuoteProgramId;
    if (data.ageRange !== undefined) setData.ageRange = data.ageRange;
    if (data.skillLevel !== undefined) setData.skillLevel = data.skillLevel;
    if (data.sport !== undefined) setData.sport = data.sport;

    if (Object.keys(setData).length === 0) {
      return this.getBooking(id);
    }

    const [updated] = await db
      .update(bookings)
      .set(setData)
      .where(eq(bookings.id, id))
      .returning();
    return updated;
  }

  async deleteBooking(id: string): Promise<boolean> {
    await db.delete(bookingParticipants).where(eq(bookingParticipants.bookingId, id));
    const result = await db.delete(bookings).where(eq(bookings.id, id)).returning();
    return result.length > 0;
  }

  async deleteBookingsByClientAndCoach(clientId: string, coachId: string): Promise<number> {
    const toDelete = await db.select({ id: bookings.id }).from(bookings)
      .where(and(eq(bookings.clientId, clientId), eq(bookings.coachId, coachId)));
    for (const b of toDelete) {
      await db.delete(bookingParticipants).where(eq(bookingParticipants.bookingId, b.id));
    }
    const result = await db.delete(bookings).where(and(eq(bookings.clientId, clientId), eq(bookings.coachId, coachId))).returning();
    return result.length;
  }

  async deleteBookingsByRecurringGroup(recurringGroupId: string, excludeCompleted: boolean = true): Promise<number> {
    const conditions: any[] = [eq(bookings.recurringGroupId, recurringGroupId)];
    if (excludeCompleted) {
      conditions.push(
        and(
          sql`${bookings.status} != 'COMPLETED'`
        )
      );
    }
    const toDelete = await db.select({ id: bookings.id }).from(bookings).where(and(...conditions));
    for (const b of toDelete) {
      await db.delete(bookingParticipants).where(eq(bookingParticipants.bookingId, b.id));
    }
    const result = await db.delete(bookings).where(and(...conditions)).returning();
    return result.length;
  }

  async getOverlappingBookings(coachId: string, startAt: Date, endAt: Date, excludeId?: string): Promise<Booking[]> {
    const conditions = [
      eq(bookings.coachId, coachId),
      or(
        eq(bookings.status, "CONFIRMED"),
        eq(bookings.status, "PENDING")
      ),
      lt(bookings.startAt, endAt),
      gt(bookings.endAt, startAt),
    ];
    const result = await db.select().from(bookings).where(and(...conditions));
    if (excludeId) {
      return result.filter(b => b.id !== excludeId);
    }
    return result;
  }

  async getBookingParticipants(bookingId: string): Promise<(BookingParticipant & { user: User })[]> {
    const result = await db
      .select()
      .from(bookingParticipants)
      .innerJoin(users, eq(bookingParticipants.userId, users.id))
      .where(eq(bookingParticipants.bookingId, bookingId));
    return result.map(r => ({ ...r.booking_participants, user: r.users }));
  }

  async addBookingParticipant(participant: InsertBookingParticipant): Promise<BookingParticipant> {
    const [created] = await db.insert(bookingParticipants).values(participant).returning();
    return created;
  }

  async removeBookingParticipant(bookingId: string, userId: string): Promise<void> {
    await db.delete(bookingParticipants).where(
      and(eq(bookingParticipants.bookingId, bookingId), eq(bookingParticipants.userId, userId))
    );
  }

  async removeBookingParticipantById(participantId: string): Promise<void> {
    await db.delete(bookingParticipants).where(eq(bookingParticipants.id, participantId));
  }

  async getOpenSemiPrivateSessions(organizationId?: string): Promise<(Booking & { service?: Service; coach?: CoachProfile & { user: User }; participantCount: number })[]> {
    const conditions = [
      sql`${bookings.maxParticipants} IS NOT NULL`,
      or(eq(bookings.status, "CONFIRMED"), eq(bookings.status, "PENDING")),
      gte(bookings.startAt, new Date()),
      sql`${bookings.teamQuoteProgramId} IS NULL`,
      sql`(${services.name} IS NULL OR LOWER(${services.name}) NOT LIKE '%team training%')`,
    ];
    if (organizationId) {
      conditions.push(eq(coachProfiles.organizationId, organizationId));
    }
    const result = await db
      .select()
      .from(bookings)
      .leftJoin(services, eq(bookings.serviceId, services.id))
      .leftJoin(coachProfiles, eq(bookings.coachId, coachProfiles.id))
      .leftJoin(users, eq(coachProfiles.userId, users.id))
      .where(and(...conditions))
      .orderBy(bookings.startAt);

    const enriched = await Promise.all(
      result.map(async (r) => {
        const participants = await db
          .select()
          .from(bookingParticipants)
          .where(eq(bookingParticipants.bookingId, r.bookings.id));
        return {
          ...r.bookings,
          service: r.services || undefined,
          coach: r.coach_profiles ? { ...r.coach_profiles, user: r.users! } : undefined,
          participantCount: participants.length,
        };
      })
    );

    return enriched.filter(b => b.participantCount < (b.maxParticipants || 0));
  }

  async getCoachRedemptions(coachId: string): Promise<Redemption[]> {
    return db.select().from(redemptions).where(eq(redemptions.coachId, coachId)).orderBy(desc(redemptions.redeemedAt));
  }

  async getAllRedemptions(): Promise<Redemption[]> {
    return db.select().from(redemptions).orderBy(desc(redemptions.redeemedAt));
  }

  async createRedemption(redemption: InsertRedemption): Promise<Redemption> {
    const [created] = await db.insert(redemptions).values(redemption).returning();
    return created;
  }

  async getRedemptionByBookingId(bookingId: string): Promise<Redemption | undefined> {
    const [result] = await db.select().from(redemptions).where(eq(redemptions.bookingId, bookingId));
    return result || undefined;
  }

  async findOrCreateUserByName(firstName: string, lastName: string, organizationId?: string | null): Promise<User> {
    const existing = await db
      .select()
      .from(users)
      .where(and(ilike(users.firstName, firstName.trim()), ilike(users.lastName, lastName.trim())));
    if (existing.length > 0) {
      if (organizationId) {
        const profile = await db.select().from(userProfiles).where(eq(userProfiles.userId, existing[0].id));
        if (profile.length > 0 && !profile[0].organizationId) {
          await db.update(userProfiles).set({ organizationId }).where(eq(userProfiles.userId, existing[0].id));
        }
      }
      return existing[0];
    }

    const id = `walk-in-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [created] = await db
      .insert(users)
      .values({ id, firstName: firstName.trim(), lastName: lastName.trim(), email: null, profileImageUrl: null })
      .returning();
    await db.insert(userProfiles).values({ userId: id, role: "CLIENT" as any, organizationId: organizationId || null });
    return created;
  }

  async findOrCreateTeamUser(teamName: string, coachEmail: string, programId: string): Promise<User> {
    const teamId = `team-${programId}`;
    const existingById = await db.select().from(users).where(eq(users.id, teamId));
    if (existingById.length > 0) return existingById[0];

    const existing = await db
      .select()
      .from(users)
      .where(and(ilike(users.firstName, teamName.trim()), ilike(users.lastName, "Team Training")));
    if (existing.length > 0) return existing[0];

    const [created] = await db
      .insert(users)
      .values({
        id: teamId,
        firstName: teamName.trim(),
        lastName: "Team Training",
        email: coachEmail,
        profileImageUrl: null,
      })
      .returning();
    await db.insert(userProfiles).values({ userId: teamId, role: "CLIENT" as any });
    return created;
  }

  async searchUsers(query: string): Promise<User[]> {
    const q = `%${query.trim()}%`;
    return db
      .select()
      .from(users)
      .where(or(ilike(users.firstName, q), ilike(users.lastName, q), ilike(users.email, q)))
      .limit(20);
  }

  async searchClientsByOrg(query: string, orgId: string): Promise<User[]> {
    const words = query.trim().split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) return [];

    // Build per-word conditions: each word must match firstName, lastName, or email
    const wordConditions = words.map(word => {
      const q = `%${word}%`;
      return or(
        ilike(users.firstName, q),
        ilike(users.lastName, q),
        ilike(users.email, q)
      );
    });

    // Join users with userProfiles scoped to the org, and apply word conditions
    const result = await db
      .selectDistinct({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        passwordHash: users.passwordHash,
        profileImageUrl: users.profileImageUrl,
        phone: users.phone,
        notes: users.notes,
        balanceCents: users.balanceCents,
        stripeCustomerId: users.stripeCustomerId,
        lastSignInAt: users.lastSignInAt,
        weeklyReminderEnabled: users.weeklyReminderEnabled,
        lastReminderSentAt: users.lastReminderSentAt,
        passwordResetToken: users.passwordResetToken,
        passwordResetTokenExpires: users.passwordResetTokenExpires,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .innerJoin(userProfiles, eq(userProfiles.userId, users.id))
      .where(and(
        eq(userProfiles.organizationId, orgId),
        ...wordConditions
      ))
      .limit(20);

    return result;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
    return user || undefined;
  }

  async hasUsedFreeSession(userId: string): Promise<boolean> {
    const freeServices = await db
      .select({ id: services.id })
      .from(services)
      .where(ilike(services.name, '%free intro%'));
    if (freeServices.length === 0) return false;
    const freeServiceIds = freeServices.map(s => s.id);
    const existing = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.clientId, userId),
          inArray(bookings.serviceId, freeServiceIds),
          ne(bookings.status, 'CANCELLED')
        )
      )
      .limit(1);
    return existing.length > 0;
  }

  async getAthleticPrograms(organizationId: string): Promise<AthleticProgram[]> {
    return db.select().from(athleticPrograms).where(eq(athleticPrograms.organizationId, organizationId)).orderBy(athleticPrograms.name);
  }

  async getAthleticProgramById(id: string): Promise<AthleticProgram | undefined> {
    const [program] = await db.select().from(athleticPrograms).where(eq(athleticPrograms.id, id)).limit(1);
    return program;
  }

  async getAthleticProgramBySlug(organizationId: string, slug: string): Promise<AthleticProgram | undefined> {
    const [program] = await db.select().from(athleticPrograms).where(and(eq(athleticPrograms.organizationId, organizationId), eq(athleticPrograms.slug, slug))).limit(1);
    return program;
  }

  async createAthleticProgram(program: InsertAthleticProgram): Promise<AthleticProgram> {
    const [created] = await db.insert(athleticPrograms).values(program).returning();
    return created;
  }

  async updateAthleticProgram(id: string, data: Partial<InsertAthleticProgram>): Promise<AthleticProgram | undefined> {
    const [updated] = await db.update(athleticPrograms).set(data).where(eq(athleticPrograms.id, id)).returning();
    return updated;
  }

  async deleteAthleticProgram(id: string): Promise<void> {
    await db.delete(athleticHourSchedules).where(eq(athleticHourSchedules.programId, id));
    await db.delete(athleticBookings).where(eq(athleticBookings.programId, id));
    await db.delete(athleticPrograms).where(eq(athleticPrograms.id, id));
  }

  async getAthleticBookings(date: string, programId: string): Promise<AthleticBooking[]> {
    return db.select().from(athleticBookings).where(and(eq(athleticBookings.date, date), eq(athleticBookings.programId, programId)));
  }

  async getAthleticBookingsInRange(startDate: string, endDate: string, programId: string): Promise<AthleticBooking[]> {
    return db.select().from(athleticBookings).where(
      and(gte(athleticBookings.date, startDate), lte(athleticBookings.date, endDate), eq(athleticBookings.programId, programId))
    );
  }

  async createAthleticBooking(booking: InsertAthleticBooking): Promise<AthleticBooking> {
    const [created] = await db.insert(athleticBookings).values(booking).returning();
    return created;
  }

  async deleteAthleticBooking(id: string): Promise<void> {
    await db.delete(athleticBookings).where(eq(athleticBookings.id, id));
  }

  async countAthleticBookingsForSlot(date: string, timeSlot: string, programId: string): Promise<number> {
    const result = await db
      .select()
      .from(athleticBookings)
      .where(and(eq(athleticBookings.date, date), eq(athleticBookings.timeSlot, timeSlot), eq(athleticBookings.programId, programId)));
    return result.length;
  }

  async getAthleticHourSchedules(programId: string): Promise<AthleticHourSchedule[]> {
    return db.select().from(athleticHourSchedules).where(eq(athleticHourSchedules.programId, programId)).orderBy(desc(athleticHourSchedules.startDate));
  }

  async getAthleticHourScheduleById(id: string): Promise<AthleticHourSchedule | undefined> {
    const [schedule] = await db.select().from(athleticHourSchedules).where(eq(athleticHourSchedules.id, id)).limit(1);
    return schedule;
  }

  async createAthleticHourSchedule(schedule: InsertAthleticHourSchedule): Promise<AthleticHourSchedule> {
    const [created] = await db.insert(athleticHourSchedules).values(schedule).returning();
    return created;
  }

  async updateAthleticHourSchedule(id: string, data: Partial<InsertAthleticHourSchedule>): Promise<AthleticHourSchedule | undefined> {
    const [updated] = await db.update(athleticHourSchedules).set(data).where(eq(athleticHourSchedules.id, id)).returning();
    return updated;
  }

  async deleteAthleticHourSchedule(id: string): Promise<void> {
    await db.delete(athleticHourSchedules).where(eq(athleticHourSchedules.id, id));
  }

  async getCoachCashouts(coachId: string): Promise<Cashout[]> {
    return db.select().from(cashouts).where(eq(cashouts.coachId, coachId)).orderBy(desc(cashouts.requestedAt));
  }

  async getAllCashouts(): Promise<Cashout[]> {
    return db.select().from(cashouts).orderBy(desc(cashouts.requestedAt));
  }

  async createCashout(cashout: InsertCashout): Promise<Cashout> {
    const [created] = await db.insert(cashouts).values(cashout).returning();
    return created;
  }

  async updateCashoutStatus(id: string, status: string): Promise<Cashout | undefined> {
    const [updated] = await db.update(cashouts).set({ status: status as any, processedAt: new Date() }).where(eq(cashouts.id, id)).returning();
    return updated;
  }

  async markRedemptionsSent(coachId: string): Promise<void> {
    await db.update(redemptions).set({ payoutStatus: "SENT" }).where(and(eq(redemptions.coachId, coachId), eq(redemptions.payoutStatus, "PENDING")));
  }

  async updateRedemptionAmount(id: string, amountCents: number): Promise<Redemption | undefined> {
    const [updated] = await db.update(redemptions).set({ amountCents }).where(eq(redemptions.id, id)).returning();
    return updated || undefined;
  }

  async getUserBalance(userId: string): Promise<number> {
    const [user] = await db.select({ balanceCents: users.balanceCents }).from(users).where(eq(users.id, userId));
    return user?.balanceCents || 0;
  }

  async creditWallet(userId: string, amountCents: number, description: string, stripeSessionId?: string): Promise<WalletTransaction> {
    const [tx] = await db.insert(walletTransactions).values({
      userId,
      type: "CREDIT" as const,
      amountCents,
      description,
      sourceType: "stripe",
      stripeSessionId: stripeSessionId || null,
    }).returning();

    await db.update(users).set({
      balanceCents: sql`${users.balanceCents} + ${amountCents}`,
    }).where(eq(users.id, userId));

    return tx;
  }

  async debitWallet(userId: string, amountCents: number, description: string, sourceType?: string, sourceId?: string): Promise<WalletTransaction> {
    const [tx] = await db.insert(walletTransactions).values({
      userId,
      type: "DEBIT" as const,
      amountCents,
      description,
      sourceType: sourceType || "redemption",
      sourceId: sourceId || null,
    }).returning();

    await db.update(users).set({
      balanceCents: sql`${users.balanceCents} - ${amountCents}`,
    }).where(eq(users.id, userId));

    return tx;
  }

  async getWalletTransactions(userId: string): Promise<WalletTransaction[]> {
    return db.select().from(walletTransactions).where(eq(walletTransactions.userId, userId)).orderBy(desc(walletTransactions.createdAt));
  }

  async updateUserStripeCustomerId(userId: string, stripeCustomerId: string): Promise<void> {
    await db.update(users).set({ stripeCustomerId }).where(eq(users.id, userId));
  }

  async getWalletTransactionByStripeSessionId(stripeSessionId: string): Promise<WalletTransaction | undefined> {
    const [tx] = await db.select().from(walletTransactions).where(eq(walletTransactions.stripeSessionId, stripeSessionId));
    return tx || undefined;
  }

  async getAllWalletTransactions(): Promise<(WalletTransaction & { user?: User; redemptionCoachName?: string; bookingLocation?: string })[]> {
    const allTx = await db.select().from(walletTransactions).orderBy(desc(walletTransactions.createdAt));
    const allUsers = await db.select().from(users);
    const userMap = new Map(allUsers.map(u => [u.id, u]));
    const allRedemptions = await db.select().from(redemptions);
    const redemptionByBookingId = new Map(allRedemptions.map(r => [r.bookingId, r]));
    const allCoaches = await db.select().from(coachProfiles);
    const coachMap = new Map(allCoaches.map(c => [c.id, c]));
    const allBookings = await db.select().from(bookings);
    const bookingMap = new Map(allBookings.map(b => [b.id, b]));
    return allTx.map(tx => {
      let redemptionCoachName: string | undefined;
      let bookingLocation: string | undefined;
      if (tx.sourceType === "redemption" && tx.sourceId) {
        const booking = bookingMap.get(tx.sourceId);
        if (booking) bookingLocation = booking.location || undefined;
        const redemption = redemptionByBookingId.get(tx.sourceId);
        if (redemption) {
          const coach = coachMap.get(redemption.coachId);
          if (coach) {
            const coachUser = userMap.get(coach.userId);
            if (coachUser) redemptionCoachName = `${coachUser.firstName || ""} ${coachUser.lastName || ""}`.trim();
          }
        }
      }
      return { ...tx, user: userMap.get(tx.userId), redemptionCoachName, bookingLocation };
    });
  }

  async getAllUserBalances(): Promise<{ id: string; firstName: string | null; lastName: string | null; email: string | null; balanceCents: number }[]> {
    return db.select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      balanceCents: users.balanceCents,
    }).from(users).orderBy(desc(users.balanceCents));
  }

  async getUserIdsByOrganization(orgId: string): Promise<string[]> {
    const profiles = await db.select({ userId: userProfiles.userId })
      .from(userProfiles)
      .where(eq(userProfiles.organizationId, orgId));
    return profiles.map(p => p.userId);
  }

  async getClientUsersWithEmailByOrg(orgId: string): Promise<{ id: string; firstName: string | null; lastName: string | null; email: string }[]> {
    const result = await db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        role: userProfiles.role,
      })
      .from(userProfiles)
      .innerJoin(users, eq(userProfiles.userId, users.id))
      .where(and(
        eq(userProfiles.organizationId, orgId),
        eq(userProfiles.role, "CLIENT" as any),
      ));
    return result
      .filter(r => r.email && r.email.trim() !== '')
      .map(r => ({ id: r.id, firstName: r.firstName, lastName: r.lastName, email: r.email as string }));
  }

  async getUserBalancesByOrganization(orgId: string): Promise<{ id: string; firstName: string | null; lastName: string | null; email: string | null; balanceCents: number }[]> {
    const orgUserIds = await this.getUserIdsByOrganization(orgId);
    if (orgUserIds.length === 0) return [];
    const allBalances = await db.select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      balanceCents: users.balanceCents,
    }).from(users).orderBy(desc(users.balanceCents));
    const orgSet = new Set(orgUserIds);
    return allBalances.filter(b => orgSet.has(b.id));
  }

  async updateLastSignIn(userId: string): Promise<void> {
    await db.update(users).set({ lastSignInAt: new Date() }).where(eq(users.id, userId));
  }

  async getInactiveUsersForReminder(sinceDays: number): Promise<User[]> {
    const cutoff = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
    const reminderCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return db.select().from(users).where(
      and(
        lte(users.lastSignInAt, cutoff),
        eq(users.weeklyReminderEnabled, true),
        or(
          sql`${users.lastReminderSentAt} IS NULL`,
          lte(users.lastReminderSentAt, reminderCutoff)
        )
      )
    );
  }

  async markReminderSent(userId: string): Promise<void> {
    await db.update(users).set({ lastReminderSentAt: new Date() }).where(eq(users.id, userId));
  }

  async getUpcomingBookingsForReminder(
    windowStartMs: number,
    windowEndMs: number
  ): Promise<Booking[]> {
    const windowStart = new Date(windowStartMs);
    const windowEnd = new Date(windowEndMs);

    return db
      .select()
      .from(bookings)
      .where(
        and(
          gte(bookings.startAt, windowStart),
          lte(bookings.startAt, windowEnd),
          eq(bookings.status, "CONFIRMED")
        )
      )
      .orderBy(bookings.startAt);
  }

  async markClientReminderSent(bookingId: string): Promise<void> {
    await db
      .update(bookings)
      .set({ clientReminderSentAt: new Date() })
      .where(eq(bookings.id, bookingId));
  }

  async markCoachReminderSent(bookingId: string): Promise<void> {
    await db
      .update(bookings)
      .set({ coachReminderSentAt: new Date() })
      .where(eq(bookings.id, bookingId));
  }

  async createTeamQuote(quote: InsertTeamQuote): Promise<TeamQuote> {
    const [created] = await db.insert(teamQuotes).values(quote).returning();
    return created;
  }

  async getTeamQuotes(coachId: string): Promise<TeamQuote[]> {
    return db.select().from(teamQuotes).where(eq(teamQuotes.createdByCoachId, coachId)).orderBy(desc(teamQuotes.createdAt));
  }

  async getAllTeamQuotes(): Promise<TeamQuote[]> {
    return db.select().from(teamQuotes).orderBy(desc(teamQuotes.createdAt));
  }

  async updateTeamQuote(id: string, data: Partial<TeamQuote>): Promise<TeamQuote | undefined> {
    const [updated] = await db.update(teamQuotes).set(data).where(eq(teamQuotes.id, id)).returning();
    return updated;
  }

  async deleteTeamQuote(id: string): Promise<boolean> {
    const result = await db.delete(teamQuotes).where(eq(teamQuotes.id, id)).returning();
    return result.length > 0;
  }

  async getTeamQuoteByStripeInvoiceId(stripeInvoiceId: string): Promise<TeamQuote | undefined> {
    const [quote] = await db.select().from(teamQuotes).where(eq(teamQuotes.stripeInvoiceId, stripeInvoiceId));
    return quote || undefined;
  }

  async getActiveTeamContracts(coachId?: string): Promise<TeamQuote[]> {
    const allQuotes = coachId
      ? await db.select().from(teamQuotes).where(eq(teamQuotes.createdByCoachId, coachId)).orderBy(desc(teamQuotes.createdAt))
      : await db.select().from(teamQuotes).orderBy(desc(teamQuotes.createdAt));

    const programMap = new Map<string, { quotes: TeamQuote[]; hasPaid: boolean }>();
    for (const q of allQuotes) {
      const key = q.programId || q.id;
      if (!programMap.has(key)) {
        programMap.set(key, { quotes: [], hasPaid: false });
      }
      const entry = programMap.get(key)!;
      entry.quotes.push(q);
      if (q.status === "PAID") entry.hasPaid = true;
    }

    const activeContracts: TeamQuote[] = [];
    programMap.forEach((entry) => {
      if (entry.hasPaid) {
        const representative = entry.quotes[0];
        activeContracts.push(representative);
      }
    });
    return activeContracts;
  }

  async getSetting(key: string): Promise<string | undefined> {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
    return row?.value;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await db.insert(appSettings).values({ key, value }).onConflictDoUpdate({
      target: appSettings.key,
      set: { value },
    });
  }

  async getAllSettings(): Promise<{ key: string; value: string }[]> {
    return db.select().from(appSettings);
  }

  async getAllOrganizations(): Promise<Organization[]> {
    return db.select().from(organizations);
  }

  async getOrganizationBySlug(slug: string): Promise<Organization | undefined> {
    const [org] = await db.select().from(organizations).where(eq(organizations.slug, slug));
    return org || undefined;
  }

  async getOrganizationById(id: string): Promise<Organization | undefined> {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, id));
    return org || undefined;
  }

  async getOrganizationByStripeCustomerId(customerId: string): Promise<Organization | undefined> {
    const [org] = await db.select().from(organizations).where(eq(organizations.stripeCustomerId, customerId));
    return org || undefined;
  }

  async getOrganizationByStripeSubscriptionId(subscriptionId: string): Promise<Organization | undefined> {
    const [org] = await db.select().from(organizations).where(eq(organizations.stripeSubscriptionId, subscriptionId));
    return org || undefined;
  }

  async updateOrganization(id: string, data: Partial<Organization>): Promise<Organization | undefined> {
    const [updated] = await db.update(organizations).set(data).where(eq(organizations.id, id)).returning();
    return updated || undefined;
  }

  async deleteOrganization(id: string): Promise<boolean> {
    await db.delete(services).where(eq(services.organizationId, id));
    await db.delete(coachProfiles).where(eq(coachProfiles.organizationId, id));
    await db.delete(userProfiles).where(eq(userProfiles.organizationId, id));
    const [deleted] = await db.delete(organizations).where(eq(organizations.id, id)).returning();
    return !!deleted;
  }

  async getCoachProfilesByOrganization(orgId: string): Promise<(CoachProfile & { user?: User })[]> {
    const coaches = await db
      .select()
      .from(coachProfiles)
      .where(and(eq(coachProfiles.organizationId, orgId), eq(coachProfiles.isActive, true)));

    const result = [];
    for (const coach of coaches) {
      const [user] = await db.select().from(users).where(eq(users.id, coach.userId));
      result.push({ ...coach, user: user || undefined });
    }
    return result;
  }

  async getOrganizationSubscriptionPlans(orgId: string): Promise<OrganizationSubscriptionPlan[]> {
    return db.select().from(organizationSubscriptionPlans).where(eq(organizationSubscriptionPlans.organizationId, orgId));
  }

  async getOrganizationSubscriptionPlan(planId: string): Promise<OrganizationSubscriptionPlan | undefined> {
    const [plan] = await db.select().from(organizationSubscriptionPlans).where(eq(organizationSubscriptionPlans.id, planId));
    return plan || undefined;
  }

  async createOrganizationSubscriptionPlan(data: InsertOrganizationSubscriptionPlan): Promise<OrganizationSubscriptionPlan> {
    const [plan] = await db.insert(organizationSubscriptionPlans).values(data).returning();
    return plan;
  }

  async deleteOrganizationSubscriptionPlan(id: string): Promise<boolean> {
    const result = await db.delete(organizationSubscriptionPlans).where(eq(organizationSubscriptionPlans.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async deleteOrganizationSubscriptionPlansByOrg(orgId: string): Promise<void> {
    await db.delete(organizationSubscriptionPlans).where(eq(organizationSubscriptionPlans.organizationId, orgId));
  }

  async getSubscriptionSchedules(orgId: string): Promise<SubscriptionSchedule[]> {
    return db.select().from(subscriptionSchedules).where(eq(subscriptionSchedules.organizationId, orgId));
  }

  async getSubscriptionSchedule(id: string): Promise<SubscriptionSchedule | undefined> {
    const [schedule] = await db.select().from(subscriptionSchedules).where(eq(subscriptionSchedules.id, id));
    return schedule;
  }

  async createSubscriptionSchedule(data: InsertSubscriptionSchedule): Promise<SubscriptionSchedule> {
    const [schedule] = await db.insert(subscriptionSchedules).values(data).returning();
    return schedule;
  }

  async deleteSubscriptionSchedule(id: string): Promise<boolean> {
    const result = await db.delete(subscriptionSchedules).where(eq(subscriptionSchedules.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async getUserSubscriptions(userId: string): Promise<UserSubscription[]> {
    return db.select().from(userSubscriptions).where(eq(userSubscriptions.userId, userId)).orderBy(desc(userSubscriptions.createdAt));
  }

  async getUserSubscriptionByPlan(userId: string, planId: string): Promise<UserSubscription | undefined> {
    const rows = await db.select().from(userSubscriptions).where(
      and(
        eq(userSubscriptions.userId, userId),
        eq(userSubscriptions.planId, planId)
      )
    );
    return rows.find(s => ["active", "trialing", "pending", "past_due"].includes(s.status));
  }

  async getUserSubscriptionByStripeId(stripeSubscriptionId: string): Promise<UserSubscription | undefined> {
    const [sub] = await db.select().from(userSubscriptions).where(eq(userSubscriptions.stripeSubscriptionId, stripeSubscriptionId));
    return sub;
  }

  async getUserSubscriptionByCheckoutSession(sessionId: string): Promise<UserSubscription | undefined> {
    const [sub] = await db.select().from(userSubscriptions).where(eq(userSubscriptions.stripeCheckoutSessionId, sessionId));
    return sub;
  }

  async createUserSubscription(data: InsertUserSubscription): Promise<UserSubscription> {
    const [sub] = await db.insert(userSubscriptions).values(data).returning();
    return sub;
  }

  async updateUserSubscription(id: string, data: Partial<UserSubscription>): Promise<UserSubscription | undefined> {
    const [sub] = await db.update(userSubscriptions).set({ ...data, updatedAt: new Date() }).where(eq(userSubscriptions.id, id)).returning();
    return sub;
  }

  async getOrganizationUserSubscriptions(orgId: string): Promise<UserSubscription[]> {
    return db.select().from(userSubscriptions).where(eq(userSubscriptions.organizationId, orgId)).orderBy(desc(userSubscriptions.createdAt));
  }

  async getLocationsByOrganization(orgId: string): Promise<Location[]> {
    return db.select().from(locations).where(eq(locations.organizationId, orgId)).orderBy(locations.name);
  }

  async getLocation(id: string): Promise<Location | undefined> {
    const [loc] = await db.select().from(locations).where(eq(locations.id, id));
    return loc;
  }

  async createLocation(location: InsertLocation): Promise<Location> {
    const [loc] = await db.insert(locations).values(location).returning();
    return loc;
  }

  async updateLocation(id: string, data: Partial<InsertLocation>): Promise<Location | undefined> {
    const [loc] = await db.update(locations).set(data).where(eq(locations.id, id)).returning();
    return loc;
  }

  async deleteLocation(id: string): Promise<boolean> {
    const result = await db.delete(locations).where(eq(locations.id, id)).returning();
    return result.length > 0;
  }

  async getBlockedTimesByCoach(coachId: string): Promise<BlockedTime[]> {
    return db.select().from(blockedTimes).where(eq(blockedTimes.coachId, coachId)).orderBy(blockedTimes.startAt);
  }

  async getBlockedTimesByOrganization(orgId: string): Promise<BlockedTime[]> {
    return db.select().from(blockedTimes).where(eq(blockedTimes.organizationId, orgId)).orderBy(blockedTimes.startAt);
  }

  async createBlockedTime(blockedTime: InsertBlockedTime): Promise<BlockedTime> {
    const [bt] = await db.insert(blockedTimes).values(blockedTime).returning();
    return bt;
  }

  async deleteBlockedTime(id: string): Promise<boolean> {
    const result = await db.delete(blockedTimes).where(eq(blockedTimes.id, id)).returning();
    return result.length > 0;
  }

  async getBookingsByOrganization(orgId: string): Promise<(Booking & { service?: Service; client?: User; coach?: CoachProfile & { user: User } })[]> {
    const orgCoaches = await db.select().from(coachProfiles).where(eq(coachProfiles.organizationId, orgId));
    const orgCoachIds = orgCoaches.map(c => c.id);
    if (orgCoachIds.length === 0) return [];

    const rows = await db
      .select()
      .from(bookings)
      .leftJoin(services, eq(bookings.serviceId, services.id))
      .leftJoin(users, eq(bookings.clientId, users.id))
      .leftJoin(coachProfiles, eq(bookings.coachId, coachProfiles.id))
      .where(inArray(bookings.coachId, orgCoachIds))
      .orderBy(desc(bookings.startAt));

    const coachUserIds = [...new Set(rows.map(r => r.coach_profiles?.userId).filter(Boolean) as string[])];
    const coachUsers = coachUserIds.length > 0
      ? await db.select().from(users).where(inArray(users.id, coachUserIds))
      : [];
    const coachUserMap = new Map(coachUsers.map(u => [u.id, u]));

    return rows.map(r => ({
      ...r.bookings,
      service: r.services ?? undefined,
      client: r.users ?? undefined,
      coach: r.coach_profiles ? { ...r.coach_profiles, user: coachUserMap.get(r.coach_profiles.userId)! } : undefined,
    }));
  }

  async getBookingsByDateRangeForOrg(
    orgId: string,
    start: Date,
    end: Date
  ): Promise<(Booking & { service?: Service; client?: User; coach?: CoachProfile & { user: User } })[]> {
    const orgCoaches = await db.select().from(coachProfiles).where(eq(coachProfiles.organizationId, orgId));
    const orgCoachIds = orgCoaches.map(c => c.id);
    if (orgCoachIds.length === 0) return [];

    const rows = await db
      .select()
      .from(bookings)
      .leftJoin(services, eq(bookings.serviceId, services.id))
      .leftJoin(users, eq(bookings.clientId, users.id))
      .leftJoin(coachProfiles, eq(bookings.coachId, coachProfiles.id))
      .where(
        and(
          inArray(bookings.coachId, orgCoachIds),
          gte(bookings.startAt, start),
          lte(bookings.startAt, end)
        )
      )
      .orderBy(bookings.startAt);

    const coachUserIds = [...new Set(rows.map(r => r.coach_profiles?.userId).filter(Boolean) as string[])];
    const coachUsers = coachUserIds.length > 0
      ? await db.select().from(users).where(inArray(users.id, coachUserIds))
      : [];
    const coachUserMap = new Map(coachUsers.map(u => [u.id, u]));

    return rows.map(r => ({
      ...r.bookings,
      service: r.services ?? undefined,
      client: r.users ?? undefined,
      coach: r.coach_profiles ? { ...r.coach_profiles, user: coachUserMap.get(r.coach_profiles.userId)! } : undefined,
    }));
  }

  async findClientsWithNoBookingsSince(
    orgId: string,
    since: Date
  ): Promise<{ id: string; firstName: string | null; lastName: string | null; email: string | null; lastBookingDate: string | null }[]> {
    const orgCoaches = await db.select().from(coachProfiles).where(eq(coachProfiles.organizationId, orgId));
    const orgCoachIds = orgCoaches.map(c => c.id);
    if (orgCoachIds.length === 0) return [];

    const allOrgBookings = await db
      .select({ clientId: bookings.clientId, startAt: bookings.startAt })
      .from(bookings)
      .where(and(inArray(bookings.coachId, orgCoachIds), ne(bookings.status, "CANCELLED")));

    const clientLastBooking = new Map<string, Date>();
    for (const b of allOrgBookings) {
      if (!b.clientId) continue;
      const bDate = new Date(b.startAt);
      const existing = clientLastBooking.get(b.clientId);
      if (!existing || bDate > existing) clientLastBooking.set(b.clientId, bDate);
    }

    const inactiveClientIds = [...clientLastBooking.entries()]
      .filter(([, lastDate]) => lastDate < since)
      .map(([id]) => id);

    if (inactiveClientIds.length === 0) return [];

    const clientUsers = await db.select().from(users).where(inArray(users.id, inactiveClientIds));
    return clientUsers.map(u => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      lastBookingDate: clientLastBooking.get(u.id)?.toISOString().split("T")[0] ?? null,
    }));
  }

  async getCoachUtilizationForOrg(
    orgId: string,
    start: Date,
    end: Date
  ): Promise<{ coachId: string; coachName: string; bookedMinutes: number; availableMinutes: number; utilizationPct: number }[]> {
    const orgCoaches = await db.select().from(coachProfiles).where(eq(coachProfiles.organizationId, orgId));
    if (orgCoaches.length === 0) return [];

    const coachUserIds = orgCoaches.map(c => c.userId);
    const coachUsers = await db.select().from(users).where(inArray(users.id, coachUserIds));
    const coachUserMap = new Map(coachUsers.map(u => [u.id, u]));

    const results = [];
    const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

    for (const coach of orgCoaches) {
      const coachUser = coachUserMap.get(coach.userId);
      const coachName = coachUser ? `${coachUser.firstName} ${coachUser.lastName}` : "Unknown";

      const coachBookings = await db
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.coachId, coach.id),
            gte(bookings.startAt, start),
            lte(bookings.startAt, end),
            ne(bookings.status, "CANCELLED")
          )
        );

      const bookedMinutes = coachBookings.reduce((sum, b) => {
        const mins = (new Date(b.endAt).getTime() - new Date(b.startAt).getTime()) / 60000;
        return sum + mins;
      }, 0);

      const blocks = await db.select().from(availabilityBlocks).where(eq(availabilityBlocks.coachId, coach.id));
      let availableMinutes = 0;
      for (const block of blocks) {
        const [sh, sm] = block.startTime.split(":").map(Number);
        const [eh, em] = block.endTime.split(":").map(Number);
        const blockMins = (eh * 60 + em) - (sh * 60 + sm);
        availableMinutes += blockMins * Math.ceil(totalDays / 7);
      }

      const utilizationPct = availableMinutes > 0 ? Math.round((bookedMinutes / availableMinutes) * 100) : 0;
      results.push({ coachId: coach.id, coachName, bookedMinutes, availableMinutes, utilizationPct });
    }

    return results;
  }

  async getWaitlistByOrganization(orgId: string): Promise<(Waitlist & { client?: User })[]> {
    const entries = await db.select().from(waitlist).where(eq(waitlist.organizationId, orgId)).orderBy(desc(waitlist.createdAt));
    const clientIds = [...new Set(entries.map(e => e.clientId))];
    const clients = clientIds.length > 0 ? await db.select().from(users).where(inArray(users.id, clientIds)) : [];
    const clientMap = new Map(clients.map(c => [c.id, c]));
    return entries.map(e => ({ ...e, client: clientMap.get(e.clientId) }));
  }

  async addToWaitlist(entry: InsertWaitlist): Promise<Waitlist> {
    const [row] = await db.insert(waitlist).values(entry).returning();
    return row;
  }

  async removeFromWaitlist(id: string): Promise<boolean> {
    const result = await db.delete(waitlist).where(eq(waitlist.id, id)).returning();
    return result.length > 0;
  }

  async logAgentAction(entry: InsertAgentActionLog): Promise<AgentActionLog> {
    const [row] = await db.insert(agentActionLog).values(entry).returning();
    return row;
  }

  async getAgentActionLog(orgId: string, limit = 50): Promise<AgentActionLog[]> {
    return db.select().from(agentActionLog).where(eq(agentActionLog.organizationId, orgId)).orderBy(desc(agentActionLog.executedAt)).limit(limit);
  }

  async undoAgentAction(id: string): Promise<boolean> {
    const result = await db.update(agentActionLog).set({ undone: true }).where(eq(agentActionLog.id, id)).returning();
    return result.length > 0;
  }

  async createAgentAction(entry: InsertAgentAction): Promise<AgentAction> {
    const [row] = await db.insert(agentActions).values(entry).returning();
    return row;
  }

  async getAgentActionById(id: string): Promise<AgentAction | undefined> {
    const [row] = await db.select().from(agentActions).where(eq(agentActions.id, id));
    return row || undefined;
  }

  async getAgentActions(orgId: string, opts: { status?: string; clientId?: string; sinceDays?: number; limit?: number } = {}): Promise<AgentAction[]> {
    const conditions: any[] = [eq(agentActions.organizationId, orgId)];
    if (opts.status) conditions.push(eq(agentActions.status, opts.status as any));
    if (opts.clientId) conditions.push(eq(agentActions.clientId, opts.clientId));
    if (opts.sinceDays) {
      const since = new Date(Date.now() - opts.sinceDays * 86400000);
      conditions.push(gte(agentActions.createdAt, since));
    }
    return db
      .select()
      .from(agentActions)
      .where(and(...conditions))
      .orderBy(desc(agentActions.createdAt))
      .limit(opts.limit ?? 100);
  }

  async updateAgentAction(id: string, data: Partial<AgentAction>): Promise<AgentAction | undefined> {
    const [row] = await db.update(agentActions).set(data as any).where(eq(agentActions.id, id)).returning();
    return row;
  }

  async getOrgAutomationLevel(orgId: string): Promise<number> {
    const [org] = await db.select({ automationLevel: organizations.automationLevel }).from(organizations).where(eq(organizations.id, orgId));
    return (org as any)?.automationLevel ?? 1;
  }

  async setOrgAutomationLevel(orgId: string, level: number): Promise<void> {
    await db.execute(sql`UPDATE organizations SET automation_level = ${level} WHERE id = ${orgId}`);
  }

  async createPasswordResetToken(data: { email: string; userId?: string; coachProfileId?: string; tokenHash: string; expiresAt: Date }): Promise<void> {
    await db.insert(passwordResetTokens).values({
      email: data.email.toLowerCase(),
      userId: data.userId || null,
      coachProfileId: data.coachProfileId || null,
      tokenHash: data.tokenHash,
      expiresAt: data.expiresAt,
    });
  }

  async invalidatePriorResetTokens(email: string): Promise<void> {
    await db.delete(passwordResetTokens).where(
      and(eq(passwordResetTokens.email, email.toLowerCase()), isNull(passwordResetTokens.usedAt))
    );
  }

  async findValidResetToken(tokenHash: string): Promise<import("@shared/models/auth").PasswordResetToken | undefined> {
    const [token] = await db.select().from(passwordResetTokens).where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, new Date())
      )
    );
    return token || undefined;
  }

  async markResetTokenUsed(id: string): Promise<void> {
    await db.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, id));
  }

  async updateUserPassword(userId: string, passwordHash: string): Promise<void> {
    await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));
  }

  async cleanupExpiredResetTokens(): Promise<void> {
    await db.delete(passwordResetTokens).where(
      or(
        lt(passwordResetTokens.expiresAt, new Date()),
        and(
          sql`${passwordResetTokens.usedAt} IS NOT NULL`,
          lt(passwordResetTokens.createdAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
        )
      )
    );
  }

  async updateCoachProfilePassword(coachProfileId: string, passwordHash: string): Promise<void> {
    await db.update(coachProfiles).set({ passwordHash }).where(eq(coachProfiles.id, coachProfileId));
  }

  async getOrgMedia(orgId: string): Promise<OrganizationMedia[]> {
    return db.select().from(organizationMedia)
      .where(eq(organizationMedia.organizationId, orgId))
      .orderBy(organizationMedia.section, organizationMedia.orderIndex);
  }

  async getOrgMediaBySection(orgId: string, section: string): Promise<OrganizationMedia[]> {
    return db.select().from(organizationMedia)
      .where(and(eq(organizationMedia.organizationId, orgId), eq(organizationMedia.section, section as any)))
      .orderBy(organizationMedia.orderIndex);
  }

  async getPublicOrgMedia(orgId: string): Promise<OrganizationMedia[]> {
    return db.select().from(organizationMedia)
      .where(and(eq(organizationMedia.organizationId, orgId), eq(organizationMedia.isActive, true)))
      .orderBy(organizationMedia.section, organizationMedia.orderIndex);
  }

  async createOrgMedia(data: InsertOrganizationMedia): Promise<OrganizationMedia> {
    const [created] = await db.insert(organizationMedia).values(data).returning();
    return created;
  }

  async updateOrgMedia(id: string, data: Partial<OrganizationMedia>): Promise<OrganizationMedia | undefined> {
    const updateData = { ...data, updatedAt: new Date() };
    const [updated] = await db.update(organizationMedia).set(updateData).where(eq(organizationMedia.id, id)).returning();
    return updated || undefined;
  }

  async deleteOrgMedia(id: string): Promise<boolean> {
    const result = await db.delete(organizationMedia).where(eq(organizationMedia.id, id)).returning();
    return result.length > 0;
  }

  async reorderOrgMedia(updates: { id: string; orderIndex: number }[]): Promise<void> {
    for (const u of updates) {
      await db.update(organizationMedia).set({ orderIndex: u.orderIndex, updatedAt: new Date() }).where(eq(organizationMedia.id, u.id));
    }
  }

  async getOrgMediaById(id: string): Promise<OrganizationMedia | undefined> {
    const [item] = await db.select().from(organizationMedia).where(eq(organizationMedia.id, id));
    return item || undefined;
  }

  async createCommunicationLog(data: InsertCommunicationLog): Promise<CommunicationLog> {
    const [row] = await db.insert(communicationLogs).values(data).returning();
    return row;
  }

  async getCommunicationsByOrg(orgId: string, limit: number = 200): Promise<CommunicationLog[]> {
    return db
      .select()
      .from(communicationLogs)
      .where(eq(communicationLogs.orgId, orgId))
      .orderBy(desc(communicationLogs.createdAt))
      .limit(limit);
  }

  async getCommunicationsByUser(userId: string): Promise<CommunicationLog[]> {
    return db
      .select()
      .from(communicationLogs)
      .where(eq(communicationLogs.userId, userId))
      .orderBy(desc(communicationLogs.createdAt));
  }

  async getCommunicationsByBooking(bookingId: string): Promise<CommunicationLog[]> {
    return db
      .select()
      .from(communicationLogs)
      .where(eq(communicationLogs.bookingId, bookingId))
      .orderBy(desc(communicationLogs.createdAt));
  }

  async getUserByUnsubscribeToken(token: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.unsubscribeToken, token));
    return user || undefined;
  }

  async ensureUnsubscribeToken(userId: string): Promise<string> {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (user?.unsubscribeToken) return user.unsubscribeToken;
    const token = randomUUID();
    await db.update(users).set({ unsubscribeToken: token }).where(eq(users.id, userId));
    return token;
  }

  async updateNotificationPreferences(userId: string, prefs: Record<string, any>): Promise<User | undefined> {
    const [updated] = await db
      .update(users)
      .set({ notificationPreferences: prefs })
      .where(eq(users.id, userId))
      .returning();
    return updated || undefined;
  }

  // ─── Per-org preferences ────────────────────────────────────────────────────

  async getOrgContextForUser(userId: string): Promise<{ orgId: string; source: string } | null> {
    // 1. Check user profile (fastest — already indexed)
    const [profile] = await db
      .select({ organizationId: userProfiles.organizationId })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId));
    if (profile?.organizationId) {
      return { orgId: profile.organizationId, source: "profile" };
    }

    // 2. Check most recent booking
    const [booking] = await db
      .select({ organizationId: bookings.organizationId })
      .from(bookings)
      .where(and(eq(bookings.clientId, userId), sql`${bookings.organizationId} IS NOT NULL`))
      .orderBy(desc(bookings.startAt))
      .limit(1);
    if (booking?.organizationId) {
      return { orgId: booking.organizationId, source: "booking" };
    }

    // 3. Check existing user_org_preferences rows
    const [prefRow] = await db
      .select({ orgId: userOrgPreferences.orgId })
      .from(userOrgPreferences)
      .where(eq(userOrgPreferences.userId, userId))
      .limit(1);
    if (prefRow?.orgId) {
      return { orgId: prefRow.orgId, source: "preferences" };
    }

    return null;
  }

  async getUserOrgPreferences(userId: string, orgId: string): Promise<UserOrgPreferences | undefined> {
    const [row] = await db
      .select()
      .from(userOrgPreferences)
      .where(and(eq(userOrgPreferences.userId, userId), eq(userOrgPreferences.orgId, orgId)));
    return row || undefined;
  }

  async upsertUserOrgPreferences(userId: string, orgId: string, data: {
    smsOptIn?: boolean;
    smsOptInAt?: Date | null;
    smsOptOutAt?: Date | null;
    notificationPreferences?: Record<string, any> | null;
  }): Promise<UserOrgPreferences> {
    const existing = await this.getUserOrgPreferences(userId, orgId);
    if (existing) {
      const [updated] = await db
        .update(userOrgPreferences)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(userOrgPreferences.userId, userId), eq(userOrgPreferences.orgId, orgId)))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(userOrgPreferences)
        .values({ userId, orgId, smsOptIn: false, ...data })
        .returning();
      return created;
    }
  }

  async ensureUserOrgPreferences(userId: string, orgId: string): Promise<UserOrgPreferences> {
    const existing = await this.getUserOrgPreferences(userId, orgId);
    if (existing) return existing;
    const user = await this.getUser(userId);
    const [created] = await db
      .insert(userOrgPreferences)
      .values({
        userId,
        orgId,
        smsOptIn: user?.smsOptIn ?? false,
        notificationPreferences: (user?.notificationPreferences as Record<string, any>) ?? null,
      })
      .returning();
    return created;
  }

  // ─── Email Agent Settings ─────────────────────────────────────────────────
  async getEmailAgentSettings(orgId: string): Promise<Record<string, any>> {
    const key = `email_agent_settings_${orgId}`;
    const row = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
    if (row.length === 0) return {};
    try { return JSON.parse(row[0].value); } catch { return {}; }
  }

  async saveEmailAgentSettings(orgId: string, settings: Record<string, any>): Promise<void> {
    const key = `email_agent_settings_${orgId}`;
    await db.insert(appSettings).values({ key, value: JSON.stringify(settings) })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify(settings) } });
  }

  async getEmailAgentOverview(orgId: string): Promise<{
    sentToday: number;
    dailyLimit: number;
    totalProspects: number;
    prospectsWithEmail: number;
    replied: number;
    interested: number;
    estimatedPipeline: number;
  }> {
    const { teamTrainingProspects, teamTrainingOutreachEvents } = await import("@shared/schema");
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [allProspects, todayEvents, settings] = await Promise.all([
      db.select().from(teamTrainingProspects).where(eq(teamTrainingProspects.orgId, orgId)),
      db.select().from(teamTrainingOutreachEvents).where(
        and(
          eq(teamTrainingOutreachEvents.orgId, orgId),
          eq(teamTrainingOutreachEvents.eventType, "sent"),
          gte(teamTrainingOutreachEvents.createdAt!, startOfToday)
        )
      ),
      this.getEmailAgentSettings(orgId),
    ]);

    const dailyLimit = settings.dailyLimit ?? 10;
    const defaultValue = settings.defaultEstimatedValue ?? 2500;
    const replied = allProspects.filter(p => p.outreachStatus === "Replied").length;
    const interested = allProspects.filter(p => p.outreachStatus === "Replied" || p.outreachStatus === "Approved").length;
    const estimatedPipeline = allProspects
      .filter(p => p.outreachStatus !== "Do Not Contact" && p.outreachStatus !== "Not Interested")
      .reduce((sum, p) => sum + (p.estimatedValue ?? defaultValue), 0);

    return {
      sentToday: todayEvents.length,
      dailyLimit,
      totalProspects: allProspects.length,
      prospectsWithEmail: allProspects.filter(p => !!p.contactEmail).length,
      replied,
      interested,
      estimatedPipeline,
    };
  }

  async buildDailyOutreachQueue(orgId: string, limit = 10): Promise<import("@shared/schema").TeamTrainingProspect[]> {
    const { teamTrainingProspects, teamTrainingOutreachEvents } = await import("@shared/schema");
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const settings = await this.getEmailAgentSettings(orgId);
    const cooldownDays = settings.cooldownDays ?? 30;
    const cutoff = new Date(Date.now() - cooldownDays * 24 * 60 * 60 * 1000);

    const [allProspects, sentToday] = await Promise.all([
      db.select().from(teamTrainingProspects).where(eq(teamTrainingProspects.orgId, orgId)),
      db.select().from(teamTrainingOutreachEvents).where(
        and(
          eq(teamTrainingOutreachEvents.orgId, orgId),
          eq(teamTrainingOutreachEvents.eventType, "sent"),
          gte(teamTrainingOutreachEvents.createdAt!, startOfToday)
        )
      ),
    ]);

    const alreadySentCount = sentToday.length;
    const remaining = Math.max(0, limit - alreadySentCount);
    if (remaining === 0) return [];

    const eligible = allProspects.filter(p => {
      if (!p.contactEmail) return false;
      if (p.outreachStatus === "Do Not Contact" || p.outreachStatus === "Not Interested") return false;
      if (p.outreachStatus === "Contacted" || p.outreachStatus === "Replied") return false;
      if (p.lastContactedAt && new Date(p.lastContactedAt) > cutoff) return false;
      return true;
    });

    eligible.sort((a, b) => {
      const scoreA = (a.confidenceScore ?? 0);
      const scoreB = (b.confidenceScore ?? 0);
      return scoreB - scoreA;
    });

    const queue = eligible.slice(0, remaining);

    for (const p of queue) {
      await db.update(teamTrainingProspects)
        .set({ queuedForTodayAt: new Date(), updatedAt: new Date() })
        .where(eq(teamTrainingProspects.id, p.id));
    }

    return queue;
  }

  async getDailyQueueProspects(orgId: string): Promise<import("@shared/schema").TeamTrainingProspect[]> {
    const { teamTrainingProspects } = await import("@shared/schema");
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return db.select().from(teamTrainingProspects).where(
      and(
        eq(teamTrainingProspects.orgId, orgId),
        gte(teamTrainingProspects.queuedForTodayAt!, startOfToday)
      )
    ).orderBy(desc(teamTrainingProspects.confidenceScore));
  }

  // ─── Team Training Prospecting Implementation ────────────────────────────
  async getTeamTrainingProspects(orgId: string, opts?: { sport?: string; outreachStatus?: string; city?: string }) {
    const { teamTrainingProspects } = await import("@shared/schema");
    let q = db.select().from(teamTrainingProspects).where(eq(teamTrainingProspects.orgId, orgId));
    const results = await q.orderBy(desc(teamTrainingProspects.createdAt));
    return results.filter((r) => {
      if (opts?.sport && r.sport?.toLowerCase() !== opts.sport.toLowerCase()) return false;
      if (opts?.outreachStatus && r.outreachStatus !== opts.outreachStatus) return false;
      if (opts?.city && !r.city?.toLowerCase().includes(opts.city.toLowerCase())) return false;
      return true;
    });
  }

  async getTeamTrainingProspect(id: string) {
    const { teamTrainingProspects } = await import("@shared/schema");
    const [row] = await db.select().from(teamTrainingProspects).where(eq(teamTrainingProspects.id, id));
    return row || undefined;
  }

  async createTeamTrainingProspect(data: import("@shared/schema").InsertTeamTrainingProspect) {
    const { teamTrainingProspects } = await import("@shared/schema");
    const [row] = await db.insert(teamTrainingProspects).values(data).returning();
    return row;
  }

  async updateTeamTrainingProspect(id: string, data: Partial<import("@shared/schema").TeamTrainingProspect>) {
    const { teamTrainingProspects } = await import("@shared/schema");
    const updateData: any = { ...data, updatedAt: new Date() };
    delete updateData.id;
    delete updateData.createdAt;
    const [row] = await db.update(teamTrainingProspects).set(updateData).where(eq(teamTrainingProspects.id, id)).returning();
    return row || undefined;
  }

  async deleteTeamTrainingProspect(id: string): Promise<boolean> {
    const { teamTrainingProspects } = await import("@shared/schema");
    await db.delete(teamTrainingProspects).where(eq(teamTrainingProspects.id, id));
    return true;
  }

  async getOutreachDraftsByProspect(prospectId: string) {
    const { teamTrainingOutreachDrafts } = await import("@shared/schema");
    return db.select().from(teamTrainingOutreachDrafts).where(eq(teamTrainingOutreachDrafts.prospectId, prospectId)).orderBy(desc(teamTrainingOutreachDrafts.createdAt));
  }

  async getOutreachDraftsByOrg(orgId: string) {
    const { teamTrainingOutreachDrafts, teamTrainingProspects } = await import("@shared/schema");
    const drafts = await db.select().from(teamTrainingOutreachDrafts).where(eq(teamTrainingOutreachDrafts.orgId, orgId)).orderBy(desc(teamTrainingOutreachDrafts.createdAt));
    const prospectIds = [...new Set(drafts.map((d) => d.prospectId))];
    const prospects = prospectIds.length > 0
      ? await db.select().from(teamTrainingProspects).where(inArray(teamTrainingProspects.id, prospectIds))
      : [];
    const prospectMap = new Map(prospects.map((p) => [p.id, p]));
    return drafts.map((d) => ({ ...d, prospect: prospectMap.get(d.prospectId) }));
  }

  async getOutreachDraft(id: string) {
    const { teamTrainingOutreachDrafts } = await import("@shared/schema");
    const [row] = await db.select().from(teamTrainingOutreachDrafts).where(eq(teamTrainingOutreachDrafts.id, id));
    return row || undefined;
  }

  async createOutreachDraft(data: import("@shared/schema").InsertTeamTrainingOutreachDraft) {
    const { teamTrainingOutreachDrafts } = await import("@shared/schema");
    const [row] = await db.insert(teamTrainingOutreachDrafts).values(data).returning();
    return row;
  }

  async updateOutreachDraft(id: string, data: Partial<import("@shared/schema").TeamTrainingOutreachDraft>) {
    const { teamTrainingOutreachDrafts } = await import("@shared/schema");
    const updateData: any = { ...data, updatedAt: new Date() };
    delete updateData.id;
    delete updateData.createdAt;
    const [row] = await db.update(teamTrainingOutreachDrafts).set(updateData).where(eq(teamTrainingOutreachDrafts.id, id)).returning();
    return row || undefined;
  }

  async logOutreachEvent(data: import("@shared/schema").InsertTeamTrainingOutreachEvent) {
    const { teamTrainingOutreachEvents } = await import("@shared/schema");
    const [row] = await db.insert(teamTrainingOutreachEvents).values(data).returning();
    return row;
  }

  async getOutreachEvents(orgId: string, prospectId?: string) {
    const { teamTrainingOutreachEvents } = await import("@shared/schema");
    if (prospectId) {
      return db.select().from(teamTrainingOutreachEvents).where(and(eq(teamTrainingOutreachEvents.orgId, orgId), eq(teamTrainingOutreachEvents.prospectId!, prospectId))).orderBy(desc(teamTrainingOutreachEvents.createdAt));
    }
    return db.select().from(teamTrainingOutreachEvents).where(eq(teamTrainingOutreachEvents.orgId, orgId)).orderBy(desc(teamTrainingOutreachEvents.createdAt));
  }

  async isProspectOptedOut(orgId: string, email: string): Promise<boolean> {
    const { prospectOptOuts } = await import("@shared/schema");
    const [row] = await db.select().from(prospectOptOuts).where(and(eq(prospectOptOuts.orgId, orgId), eq(prospectOptOuts.email, email.toLowerCase())));
    return !!row;
  }

  async addProspectOptOut(orgId: string, email: string, reason?: string): Promise<void> {
    const { prospectOptOuts } = await import("@shared/schema");
    await db.insert(prospectOptOuts).values({ orgId, email: email.toLowerCase(), reason }).onConflictDoNothing();
  }

  async getProspectDashboardStats(orgId: string): Promise<{ newLeads: number; pendingApproval: number; sentThisWeek: number; replies: number }> {
    const { teamTrainingProspects, teamTrainingOutreachDrafts, teamTrainingOutreachEvents } = await import("@shared/schema");
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 7);

    const [allProspects, allDrafts, weekEvents] = await Promise.all([
      db.select().from(teamTrainingProspects).where(eq(teamTrainingProspects.orgId, orgId)),
      db.select().from(teamTrainingOutreachDrafts).where(and(eq(teamTrainingOutreachDrafts.orgId, orgId), eq(teamTrainingOutreachDrafts.approved, false))),
      db.select().from(teamTrainingOutreachEvents).where(and(eq(teamTrainingOutreachEvents.orgId, orgId), gte(teamTrainingOutreachEvents.createdAt!, weekStart))),
    ]);

    return {
      newLeads: allProspects.filter((p) => p.outreachStatus === "New").length,
      pendingApproval: allDrafts.length,
      sentThisWeek: weekEvents.filter((e) => e.eventType === "sent").length,
      replies: weekEvents.filter((e) => e.eventType === "replied").length,
    };
  }

  async backfillUserOrgPreferences(): Promise<{ created: number; skipped: number }> {
    let created = 0;
    let skipped = 0;

    // Collect all (userId, orgId) pairs from all relationship tables
    const pairs = new Map<string, Set<string>>(); // userId -> Set<orgId>

    const addPair = (userId: string, orgId: string) => {
      if (!userId || !orgId) return;
      if (!pairs.has(userId)) pairs.set(userId, new Set());
      pairs.get(userId)!.add(orgId);
    };

    const [profiles, coaches, bkgs, subs] = await Promise.all([
      db.select({ userId: userProfiles.userId, orgId: userProfiles.organizationId }).from(userProfiles),
      db.select({ userId: coachProfiles.userId, orgId: coachProfiles.organizationId }).from(coachProfiles),
      db.select({ userId: bookings.clientId, orgId: bookings.organizationId }).from(bookings),
      db.select({ userId: userSubscriptions.userId, orgId: userSubscriptions.organizationId }).from(userSubscriptions),
    ]);

    for (const r of profiles) if (r.userId && r.orgId) addPair(r.userId, r.orgId);
    for (const r of coaches) if (r.userId && r.orgId) addPair(r.userId, r.orgId);
    for (const r of bkgs) if (r.userId && r.orgId) addPair(r.userId, r.orgId);
    for (const r of subs) if (r.userId && r.orgId) addPair(r.userId, r.orgId);

    for (const [userId, orgIds] of pairs) {
      const user = await this.getUser(userId);
      for (const orgId of orgIds) {
        const existing = await this.getUserOrgPreferences(userId, orgId);
        if (existing) {
          skipped++;
          continue;
        }
        await db.insert(userOrgPreferences).values({
          userId,
          orgId,
          smsOptIn: user?.smsOptIn ?? false,
          notificationPreferences: (user?.notificationPreferences as Record<string, any>) ?? null,
        });
        created++;
      }
    }

    return { created, skipped };
  }

  // ─── Email Message Variants ─────────────────────────────────────────────────

  async getEmailMessageVariants(orgId: string): Promise<import("@shared/schema").EmailMessageVariant[]> {
    const { emailMessageVariants } = await import("@shared/schema");
    return db.select().from(emailMessageVariants)
      .where(and(eq(emailMessageVariants.orgId, orgId), eq(emailMessageVariants.active, true)))
      .orderBy(desc(emailMessageVariants.performanceScore));
  }

  async createEmailMessageVariant(data: import("@shared/schema").InsertEmailMessageVariant): Promise<import("@shared/schema").EmailMessageVariant> {
    const { emailMessageVariants } = await import("@shared/schema");
    const [row] = await db.insert(emailMessageVariants).values(data).returning();
    return row;
  }

  async updateEmailMessageVariant(id: string, data: Partial<import("@shared/schema").EmailMessageVariant>): Promise<import("@shared/schema").EmailMessageVariant | undefined> {
    const { emailMessageVariants } = await import("@shared/schema");
    const updateData: any = { ...data, updatedAt: new Date() };
    delete updateData.id;
    delete updateData.createdAt;
    const [row] = await db.update(emailMessageVariants).set(updateData).where(eq(emailMessageVariants.id, id)).returning();
    return row || undefined;
  }

  async getEmailMessageVariant(id: string): Promise<import("@shared/schema").EmailMessageVariant | undefined> {
    const { emailMessageVariants } = await import("@shared/schema");
    const [row] = await db.select().from(emailMessageVariants).where(eq(emailMessageVariants.id, id));
    return row || undefined;
  }

  async deleteEmailMessageVariant(id: string): Promise<boolean> {
    const { emailMessageVariants } = await import("@shared/schema");
    await db.update(emailMessageVariants).set({ active: false, updatedAt: new Date() }).where(eq(emailMessageVariants.id, id));
    return true;
  }

  async selectVariantForEmail(orgId: string): Promise<import("@shared/schema").EmailMessageVariant | null> {
    const { emailMessageVariants } = await import("@shared/schema");
    const variants = await db.select().from(emailMessageVariants)
      .where(and(eq(emailMessageVariants.orgId, orgId), eq(emailMessageVariants.active, true)));
    if (variants.length === 0) return null;

    // Weighted random selection
    const totalWeight = variants.reduce((sum, v) => sum + (v.weight ?? 34), 0);
    let rand = Math.floor(Math.random() * totalWeight);
    for (const variant of variants) {
      rand -= (variant.weight ?? 34);
      if (rand < 0) return variant;
    }
    return variants[0];
  }

  async runVariantOptimization(orgId: string): Promise<void> {
    const { emailMessageVariants, teamTrainingOutreachDrafts } = await import("@shared/schema");
    const variants = await db.select().from(emailMessageVariants)
      .where(and(eq(emailMessageVariants.orgId, orgId), eq(emailMessageVariants.active, true)));
    if (variants.length < 2) return;

    // Recalculate performance scores based on reply + conversion rates
    const scored = variants.map((v) => {
      const used = v.timesUsed || 1;
      const replyRate = (v.replies || 0) / used;
      const convRate = (v.conversions || 0) / used;
      const score = Math.round((replyRate * 0.6 + convRate * 0.4) * 100);
      return { ...v, calcScore: score };
    });

    scored.sort((a, b) => b.calcScore - a.calcScore);

    const weights = [50, 30, 20];
    for (let i = 0; i < scored.length; i++) {
      const w = weights[i] ?? 10;
      const s = Math.round(scored[i].calcScore);
      await db.update(emailMessageVariants)
        .set({ weight: w, performanceScore: s, updatedAt: new Date() })
        .where(eq(emailMessageVariants.id, scored[i].id));
    }

    console.log(`[Variant Optimization] org ${orgId} — reweighted ${scored.length} variants`);
  }

  async createFollowUp(data: import("@shared/schema").InsertEmailFollowUp): Promise<import("@shared/schema").EmailFollowUp> {
    const { emailFollowUps } = await import("@shared/schema");
    const [row] = await db.insert(emailFollowUps).values(data).returning();
    return row;
  }

  async getFollowUpsByOrg(orgId: string): Promise<(import("@shared/schema").EmailFollowUp & { prospect?: import("@shared/schema").TeamTrainingProspect })[]> {
    const { emailFollowUps, teamTrainingProspects } = await import("@shared/schema");
    const rows = await db.select().from(emailFollowUps)
      .where(eq(emailFollowUps.orgId, orgId))
      .orderBy(desc(emailFollowUps.scheduledFor));
    const prospectIds = [...new Set(rows.map(r => r.prospectId))];
    const prospects = prospectIds.length > 0
      ? await db.select().from(teamTrainingProspects).where(inArray(teamTrainingProspects.id, prospectIds))
      : [];
    const prospectMap = Object.fromEntries(prospects.map(p => [p.id, p]));
    return rows.map(r => ({ ...r, prospect: prospectMap[r.prospectId] }));
  }

  async getFollowUpsByDraft(outreachDraftId: string): Promise<import("@shared/schema").EmailFollowUp[]> {
    const { emailFollowUps } = await import("@shared/schema");
    return db.select().from(emailFollowUps)
      .where(eq(emailFollowUps.outreachDraftId, outreachDraftId))
      .orderBy(emailFollowUps.stepNumber);
  }

  async getFollowUp(id: string): Promise<import("@shared/schema").EmailFollowUp | undefined> {
    const { emailFollowUps } = await import("@shared/schema");
    const [row] = await db.select().from(emailFollowUps).where(eq(emailFollowUps.id, id));
    return row;
  }

  async updateFollowUp(id: string, data: Partial<import("@shared/schema").EmailFollowUp>): Promise<import("@shared/schema").EmailFollowUp | undefined> {
    const { emailFollowUps } = await import("@shared/schema");
    const [row] = await db.update(emailFollowUps)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(emailFollowUps.id, id))
      .returning();
    return row;
  }

  async getDueFollowUps(orgId: string): Promise<import("@shared/schema").EmailFollowUp[]> {
    const { emailFollowUps } = await import("@shared/schema");
    return db.select().from(emailFollowUps)
      .where(and(
        eq(emailFollowUps.orgId, orgId),
        eq(emailFollowUps.status, "pending"),
        lte(emailFollowUps.scheduledFor, new Date()),
      ));
  }

  async cancelFollowUpSequence(outreachDraftId: string): Promise<void> {
    const { emailFollowUps } = await import("@shared/schema");
    await db.update(emailFollowUps)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(and(
        eq(emailFollowUps.outreachDraftId, outreachDraftId),
        eq(emailFollowUps.status, "pending"),
      ));
  }

  async getFollowUpStats(orgId: string): Promise<{ activeSequences: number; pendingReplies: number; interestedLeads: number }> {
    const { emailFollowUps, teamTrainingOutreachDrafts, teamTrainingProspects } = await import("@shared/schema");
    const pending = await db.select().from(emailFollowUps)
      .where(and(eq(emailFollowUps.orgId, orgId), eq(emailFollowUps.status, "pending")));
    const activeSequences = new Set(pending.map(f => f.outreachDraftId)).size;

    const replied = await db.select().from(teamTrainingProspects)
      .where(and(eq(teamTrainingProspects.orgId, orgId), eq(teamTrainingProspects.outreachStatus, "Replied")));
    const pendingReplies = replied.length;

    const draftsWithInterested = await db.select().from(teamTrainingOutreachDrafts)
      .where(and(
        eq(teamTrainingOutreachDrafts.orgId, orgId),
        eq(teamTrainingOutreachDrafts.replyClassification, "interested"),
      ));
    const interestedLeads = draftsWithInterested.length;

    return { activeSequences, pendingReplies, interestedLeads };
  }

  async getEmailPerformanceStats(orgId: string): Promise<{
    sent: number;
    opened: number;
    clicked: number;
    replied: number;
    openRate: number;
    clickRate: number;
    replyRate: number;
    conversionRate: number;
    bestVariant: import("@shared/schema").EmailMessageVariant | null;
  }> {
    const { teamTrainingOutreachDrafts, emailMessageVariants } = await import("@shared/schema");

    const drafts = await db.select().from(teamTrainingOutreachDrafts)
      .where(and(eq(teamTrainingOutreachDrafts.orgId, orgId), isNotNull(teamTrainingOutreachDrafts.sentAt)));

    const sent = drafts.length;
    const opened = drafts.filter(d => !!d.openedAt).length;
    const clicked = drafts.filter(d => !!d.clickedAt).length;
    const replied = drafts.filter(d => !!d.repliedAt).length;
    const conversions = drafts.filter(d => !!d.repliedAt).length;

    const openRate = sent > 0 ? Math.round((opened / sent) * 100) : 0;
    const clickRate = sent > 0 ? Math.round((clicked / sent) * 100) : 0;
    const replyRate = sent > 0 ? Math.round((replied / sent) * 100) : 0;
    const conversionRate = sent > 0 ? Math.round((conversions / sent) * 100) : 0;

    const [bestVariant] = await db.select().from(emailMessageVariants)
      .where(and(eq(emailMessageVariants.orgId, orgId), eq(emailMessageVariants.active, true)))
      .orderBy(desc(emailMessageVariants.performanceScore))
      .limit(1);

    return { sent, opened, clicked, replied, openRate, clickRate, replyRate, conversionRate, bestVariant: bestVariant ?? null };
  }

  // ─── Team Training Deals ─────────────────────────────────────────────────────

  async getTeamTrainingDeals(orgId: string): Promise<(import("@shared/schema").TeamTrainingDeal & { prospect?: import("@shared/schema").TeamTrainingProspect })[]> {
    const { teamTrainingDeals, teamTrainingProspects } = await import("@shared/schema");
    const deals = await db.select().from(teamTrainingDeals)
      .where(eq(teamTrainingDeals.organizationId, orgId))
      .orderBy(desc(teamTrainingDeals.lastActivityAt));
    if (deals.length === 0) return [];
    const prospectIds = [...new Set(deals.map(d => d.prospectId))];
    const prospects = await db.select().from(teamTrainingProspects)
      .where(inArray(teamTrainingProspects.id, prospectIds));
    const prospectMap = new Map(prospects.map(p => [p.id, p]));
    return deals.map(d => ({ ...d, prospect: prospectMap.get(d.prospectId) }));
  }

  async getTeamTrainingDeal(id: string): Promise<import("@shared/schema").TeamTrainingDeal | undefined> {
    const { teamTrainingDeals } = await import("@shared/schema");
    const [row] = await db.select().from(teamTrainingDeals).where(eq(teamTrainingDeals.id, id));
    return row;
  }

  async getTeamTrainingDealByProspect(prospectId: string, orgId: string): Promise<import("@shared/schema").TeamTrainingDeal | undefined> {
    const { teamTrainingDeals } = await import("@shared/schema");
    const [row] = await db.select().from(teamTrainingDeals)
      .where(and(eq(teamTrainingDeals.prospectId, prospectId), eq(teamTrainingDeals.organizationId, orgId)));
    return row;
  }

  async createTeamTrainingDeal(data: import("@shared/schema").InsertTeamTrainingDeal): Promise<import("@shared/schema").TeamTrainingDeal> {
    const { teamTrainingDeals } = await import("@shared/schema");
    const [row] = await db.insert(teamTrainingDeals).values(data).returning();
    return row;
  }

  async updateTeamTrainingDeal(id: string, data: Partial<import("@shared/schema").TeamTrainingDeal>): Promise<import("@shared/schema").TeamTrainingDeal | undefined> {
    const { teamTrainingDeals } = await import("@shared/schema");
    const updateData = { ...data, updatedAt: new Date(), lastActivityAt: new Date() };
    const [row] = await db.update(teamTrainingDeals).set(updateData).where(eq(teamTrainingDeals.id, id)).returning();
    return row;
  }

  async deleteTeamTrainingDeal(id: string): Promise<boolean> {
    const { teamTrainingDeals } = await import("@shared/schema");
    await db.delete(teamTrainingDeals).where(eq(teamTrainingDeals.id, id));
    return true;
  }

  async getDealPipelineStats(orgId: string): Promise<{ active: number; interested: number; negotiating: number; projectedRevenue: number; wonRevenue: number }> {
    const { teamTrainingDeals } = await import("@shared/schema");
    const deals = await db.select().from(teamTrainingDeals).where(eq(teamTrainingDeals.organizationId, orgId));
    const active = deals.filter(d => !["won", "lost"].includes(d.status)).length;
    const interested = deals.filter(d => d.status === "interested").length;
    const negotiating = deals.filter(d => d.status === "negotiating").length;
    const projectedRevenue = deals
      .filter(d => !["won", "lost"].includes(d.status))
      .reduce((sum, d) => sum + Math.round((d.estimatedValue * d.probability) / 100), 0);
    const wonRevenue = deals
      .filter(d => d.status === "won")
      .reduce((sum, d) => sum + (d.finalValue ?? d.estimatedValue), 0);
    return { active, interested, negotiating, projectedRevenue, wonRevenue };
  }
}

export const storage = new DatabaseStorage();
