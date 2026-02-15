import {
  users,
  userProfiles,
  coachProfiles,
  services,
  availabilityBlocks,
  bookings,
  bookingParticipants,
  redemptions,
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
} from "@shared/schema";
import type { User } from "@shared/models/auth";
import { db } from "./db";
import { eq, and, gte, lte, gt, lt, or, desc, sql, ilike } from "drizzle-orm";

export interface IStorage {
  getUserProfile(userId: string): Promise<UserProfile | undefined>;
  upsertUserProfile(profile: InsertUserProfile): Promise<UserProfile>;
  getAllUsersWithProfiles(): Promise<(User & { profile?: UserProfile })[]>;

  getCoachProfiles(): Promise<(CoachProfile & { user: User })[]>;
  getCoachProfile(id: string): Promise<(CoachProfile & { user: User }) | undefined>;
  getCoachProfileByUserId(userId: string): Promise<CoachProfile | undefined>;
  getCoachProfileByEmail(email: string): Promise<CoachProfile | undefined>;
  createCoachProfile(profile: InsertCoachProfile): Promise<CoachProfile>;
  updateCoachProfile(id: string, data: Partial<CoachProfile>): Promise<CoachProfile | undefined>;

  getServices(): Promise<Service[]>;
  getService(id: string): Promise<Service | undefined>;
  createService(service: InsertService): Promise<Service>;
  updateService(id: string, data: Partial<Service>): Promise<Service | undefined>;

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
  updateBooking(id: string, data: { serviceId?: string; startAt?: Date; endAt?: Date; notes?: string; groupDescription?: string; maxParticipants?: number | null; clientId?: string }): Promise<Booking | undefined>;
  deleteBooking(id: string): Promise<boolean>;
  getOverlappingBookings(coachId: string, startAt: Date, endAt: Date, excludeId?: string): Promise<Booking[]>;

  getBookingParticipants(bookingId: string): Promise<(BookingParticipant & { user: User })[]>;
  addBookingParticipant(participant: InsertBookingParticipant): Promise<BookingParticipant>;
  removeBookingParticipant(bookingId: string, userId: string): Promise<void>;
  getOpenSemiPrivateSessions(): Promise<(Booking & { service?: Service; coach?: CoachProfile & { user: User }; participantCount: number })[]>;

  getCoachRedemptions(coachId: string): Promise<Redemption[]>;
  getAllRedemptions(): Promise<Redemption[]>;
  createRedemption(redemption: InsertRedemption): Promise<Redemption>;
  getRedemptionByBookingId(bookingId: string): Promise<Redemption | undefined>;
  findOrCreateUserByName(firstName: string, lastName: string): Promise<User>;
  searchUsers(query: string): Promise<User[]>;
  getUserByEmail(email: string): Promise<User | undefined>;
}

export class DatabaseStorage implements IStorage {
  async getUserProfile(userId: string): Promise<UserProfile | undefined> {
    const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId));
    return profile || undefined;
  }

  async upsertUserProfile(profile: InsertUserProfile): Promise<UserProfile> {
    const [existing] = await db.select().from(userProfiles).where(eq(userProfiles.userId, profile.userId));
    if (existing) {
      const [updated] = await db.update(userProfiles).set({ role: profile.role }).where(eq(userProfiles.userId, profile.userId)).returning();
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

  async getServices(): Promise<Service[]> {
    return db.select().from(services);
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

  async updateBooking(id: string, data: { serviceId?: string; startAt?: Date; endAt?: Date; notes?: string; groupDescription?: string; maxParticipants?: number | null; clientId?: string }): Promise<Booking | undefined> {
    const setData: any = {};
    if (data.serviceId !== undefined) setData.serviceId = data.serviceId;
    if (data.startAt !== undefined) setData.startAt = data.startAt;
    if (data.endAt !== undefined) setData.endAt = data.endAt;
    if (data.notes !== undefined) setData.notes = data.notes;
    if (data.groupDescription !== undefined) setData.groupDescription = data.groupDescription;
    if (data.maxParticipants !== undefined) setData.maxParticipants = data.maxParticipants;
    if (data.clientId !== undefined) setData.clientId = data.clientId;

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

  async getOpenSemiPrivateSessions(): Promise<(Booking & { service?: Service; coach?: CoachProfile & { user: User }; participantCount: number })[]> {
    const result = await db
      .select()
      .from(bookings)
      .leftJoin(services, eq(bookings.serviceId, services.id))
      .leftJoin(coachProfiles, eq(bookings.coachId, coachProfiles.id))
      .leftJoin(users, eq(coachProfiles.userId, users.id))
      .where(
        and(
          sql`${bookings.maxParticipants} IS NOT NULL`,
          or(eq(bookings.status, "CONFIRMED"), eq(bookings.status, "PENDING")),
          gte(bookings.startAt, new Date())
        )
      )
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

  async findOrCreateUserByName(firstName: string, lastName: string): Promise<User> {
    const existing = await db
      .select()
      .from(users)
      .where(and(ilike(users.firstName, firstName.trim()), ilike(users.lastName, lastName.trim())));
    if (existing.length > 0) return existing[0];

    const id = `walk-in-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [created] = await db
      .insert(users)
      .values({ id, firstName: firstName.trim(), lastName: lastName.trim(), email: null, profileImageUrl: null })
      .returning();
    await db.insert(userProfiles).values({ userId: id, role: "CLIENT" as any });
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
}

export const storage = new DatabaseStorage();
