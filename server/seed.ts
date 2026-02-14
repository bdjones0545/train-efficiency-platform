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
      bio: "NSCA-certified strength coach with 8 years of experience. Specializing in powerlifting, Olympic lifting, and athletic performance. I believe in building a strong foundation through progressive overload and proper form.",
      specialties: ["Powerlifting", "Olympic Lifting", "Athletic Performance"],
      timezone: "America/New_York",
      isActive: true,
    }).onConflictDoNothing().returning();

    const [cp2] = await db.insert(coachProfiles).values({
      userId: "seed-coach-2",
      bio: "Former collegiate athlete turned strength coach. 6 years experience in functional training and mobility work. My approach combines traditional strength training with mobility and injury prevention strategies.",
      specialties: ["Functional Training", "Mobility", "Injury Prevention", "General Fitness"],
      timezone: "America/Chicago",
      isActive: true,
    }).onConflictDoNothing().returning();

    await db.insert(services).values([
      {
        name: "1:1 Training (60 min)",
        description: "One-on-one personalized strength training session with your coach. Includes warm-up, main lifts, accessory work, and cool-down.",
        durationMin: 60,
        priceCents: 7500,
        active: true,
      },
      {
        name: "1:1 Training (30 min)",
        description: "A focused half-hour session ideal for technique work or supplementary training.",
        durationMin: 30,
        priceCents: 4500,
        active: true,
      },
      {
        name: "Assessment Session (90 min)",
        description: "Comprehensive initial assessment including movement screening, goal setting, and program design consultation.",
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
