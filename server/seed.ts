import { db } from "./db";
import { users } from "@shared/models/auth";
import { userProfiles, coachProfiles, services, availabilityBlocks } from "@shared/schema";
import { sql } from "drizzle-orm";

export async function seedDatabase() {
  try {
    const existingServices = await db.select().from(services);
    if (existingServices.length > 0) {
      console.log("Database already seeded, skipping...");
      return;
    }

    console.log("Seeding database...");

    const [coach1User] = await db.insert(users).values({
      id: "seed-coach-1",
      email: "sarah.chen@efficiency-st.com",
      firstName: "Sarah",
      lastName: "Chen",
      profileImageUrl: null,
    }).onConflictDoNothing().returning();

    const [coach2User] = await db.insert(users).values({
      id: "seed-coach-2",
      email: "marcus.williams@efficiency-st.com",
      firstName: "Marcus",
      lastName: "Williams",
      profileImageUrl: null,
    }).onConflictDoNothing().returning();

    const [adminUser] = await db.insert(users).values({
      id: "seed-admin-1",
      email: "admin@efficiency-st.com",
      firstName: "Admin",
      lastName: "User",
      profileImageUrl: null,
    }).onConflictDoNothing().returning();

    if (coach1User) {
      await db.insert(userProfiles).values({ userId: "seed-coach-1", role: "COACH" }).onConflictDoNothing();
    }
    if (coach2User) {
      await db.insert(userProfiles).values({ userId: "seed-coach-2", role: "COACH" }).onConflictDoNothing();
    }
    if (adminUser) {
      await db.insert(userProfiles).values({ userId: "seed-admin-1", role: "ADMIN" }).onConflictDoNothing();
    }

    const [cp1] = await db.insert(coachProfiles).values({
      userId: "seed-coach-1",
      bio: "NSCA-certified strength & conditioning coach with 8 years of experience. Specializing in sports performance, Olympic lifting, and power development. I build programs that translate to on-field results through progressive overload and sport-specific training.",
      specialties: ["Sports Performance", "Olympic Lifting", "Power Development", "Speed & Agility"],
      timezone: "America/New_York",
      isActive: true,
    }).onConflictDoNothing().returning();

    const [cp2] = await db.insert(coachProfiles).values({
      userId: "seed-coach-2",
      bio: "Former collegiate athlete turned S&C coach. 6 years experience developing athletes across multiple sports. My approach combines explosive strength development with mobility and injury prevention to keep athletes performing at their peak.",
      specialties: ["Athletic Development", "Mobility", "Injury Prevention", "Conditioning"],
      timezone: "America/Chicago",
      isActive: true,
    }).onConflictDoNothing().returning();

    await db.insert(services).values([
      {
        name: "1:1 S&C Session (60 min)",
        description: "One-on-one strength & conditioning session with your coach. Includes warm-up, main lifts, sport-specific accessory work, and cool-down.",
        durationMin: 60,
        priceCents: 7500,
        active: true,
      },
      {
        name: "1:1 S&C Session (30 min)",
        description: "A focused half-hour session ideal for technique work, speed drills, or supplementary conditioning.",
        durationMin: 30,
        priceCents: 4500,
        active: true,
      },
      {
        name: "Athlete Assessment (90 min)",
        description: "Comprehensive initial assessment including movement screening, sport-specific evaluation, and program design consultation.",
        durationMin: 90,
        priceCents: 12000,
        active: true,
      },
    ]);

    if (cp1) {
      await db.insert(availabilityBlocks).values([
        { coachId: cp1.id, dayOfWeek: 0, startTime: "06:00", endTime: "12:00" },
        { coachId: cp1.id, dayOfWeek: 0, startTime: "14:00", endTime: "19:00" },
        { coachId: cp1.id, dayOfWeek: 1, startTime: "06:00", endTime: "12:00" },
        { coachId: cp1.id, dayOfWeek: 2, startTime: "06:00", endTime: "12:00" },
        { coachId: cp1.id, dayOfWeek: 2, startTime: "14:00", endTime: "19:00" },
        { coachId: cp1.id, dayOfWeek: 3, startTime: "06:00", endTime: "12:00" },
        { coachId: cp1.id, dayOfWeek: 4, startTime: "06:00", endTime: "12:00" },
        { coachId: cp1.id, dayOfWeek: 4, startTime: "14:00", endTime: "18:00" },
      ]);
    }

    if (cp2) {
      await db.insert(availabilityBlocks).values([
        { coachId: cp2.id, dayOfWeek: 0, startTime: "08:00", endTime: "16:00" },
        { coachId: cp2.id, dayOfWeek: 1, startTime: "08:00", endTime: "16:00" },
        { coachId: cp2.id, dayOfWeek: 2, startTime: "08:00", endTime: "16:00" },
        { coachId: cp2.id, dayOfWeek: 3, startTime: "08:00", endTime: "16:00" },
        { coachId: cp2.id, dayOfWeek: 4, startTime: "08:00", endTime: "14:00" },
        { coachId: cp2.id, dayOfWeek: 5, startTime: "09:00", endTime: "13:00" },
      ]);
    }

    console.log("Database seeded successfully!");
  } catch (error) {
    console.error("Error seeding database:", error);
  }
}
