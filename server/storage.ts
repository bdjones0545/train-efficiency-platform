import {
  users,
  userProfiles,
  coachProfiles,
  services,
  availabilityBlocks,
  bookings,
  bookingParticipants,
  redemptions,
  athleticBookings,
  cashouts,
  walletTransactions,
  appSettings,
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
  type AthleticBooking,
  type InsertAthleticBooking,
  type Cashout,
  type InsertCashout,
  type WalletTransaction,
  type InsertWalletTransaction,
  teamQuotes,
  type TeamQuote,
  type InsertTeamQuote,
  organizations,
  type Organization,
  organizationSubscriptionPlans,
  type OrganizationSubscriptionPlan,
  type InsertOrganizationSubscriptionPlan,
  subscriptionSchedules,
  type SubscriptionSchedule,
  type InsertSubscriptionSchedule,
  userSubscriptions,
  type UserSubscription,
  type InsertUserSubscription,
} from "@shared/schema";
import type { User } from "@shared/models/auth";
import { db } from "./db";
import { eq, and, gte, lte, gt, lt, or, desc, sql, ilike, inArray, ne } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserProfile(userId: string): Promise<UserProfile | undefined>;
  upsertUserProfile(profile: InsertUserProfile): Promise<UserProfile>;
  getAllUsersWithProfiles(): Promise<(User & { profile?: UserProfile })[]>;
  updateUser(id: string, data: { firstName?: string; lastName?: string; email?: string | null }): Promise<User | undefined>;
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
  getUserByEmail(email: string): Promise<User | undefined>;
  hasUsedFreeSession(userId: string): Promise<boolean>;

  getAthleticBookings(date: string): Promise<AthleticBooking[]>;
  createAthleticBooking(booking: InsertAthleticBooking): Promise<AthleticBooking>;
  deleteAthleticBooking(id: string): Promise<void>;
  countAthleticBookingsForSlot(date: string, timeSlot: string): Promise<number>;

  getCoachCashouts(coachId: string): Promise<Cashout[]>;
  getAllCashouts(): Promise<Cashout[]>;
  createCashout(cashout: InsertCashout): Promise<Cashout>;
  updateCashoutStatus(id: string, status: string): Promise<Cashout | undefined>;
  markRedemptionsSent(coachId: string): Promise<void>;

  getAllWalletTransactions(): Promise<(WalletTransaction & { user?: User; redemptionCoachName?: string; bookingLocation?: string })[]>;
  getAllUserBalances(): Promise<{ id: string; firstName: string | null; lastName: string | null; email: string | null; balanceCents: number }[]>;
  getUserIdsByOrganization(orgId: string): Promise<string[]>;
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

  async updateUser(id: string, data: { firstName?: string; lastName?: string; email?: string | null }): Promise<User | undefined> {
    const setData: any = {};
    if (data.firstName !== undefined) setData.firstName = data.firstName;
    if (data.lastName !== undefined) setData.lastName = data.lastName;
    if (data.email !== undefined) setData.email = data.email;
    if (Object.keys(setData).length === 0) return this.getUser(id);
    const [updated] = await db.update(users).set(setData).where(eq(users.id, id)).returning();
    return updated;
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

  async getAthleticBookings(date: string): Promise<AthleticBooking[]> {
    return db.select().from(athleticBookings).where(eq(athleticBookings.date, date));
  }

  async createAthleticBooking(booking: InsertAthleticBooking): Promise<AthleticBooking> {
    const [created] = await db.insert(athleticBookings).values(booking).returning();
    return created;
  }

  async deleteAthleticBooking(id: string): Promise<void> {
    await db.delete(athleticBookings).where(eq(athleticBookings.id, id));
  }

  async countAthleticBookingsForSlot(date: string, timeSlot: string): Promise<number> {
    const result = await db
      .select()
      .from(athleticBookings)
      .where(and(eq(athleticBookings.date, date), eq(athleticBookings.timeSlot, timeSlot)));
    return result.length;
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
}

export const storage = new DatabaseStorage();
