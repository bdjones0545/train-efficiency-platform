import { db } from "./db";
import { users } from "@shared/models/auth";
import { userProfiles, coachProfiles, services } from "@shared/schema";
import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";

export async function seedDatabase() {
  try {
    const existingServices = await db.select().from(services);
    if (existingServices.length > 0) {
      console.log("Database already seeded, skipping...");
      return;
    }

    console.log("Seeding database...");

    const [adminUser] = await db.insert(users).values({
      id: "seed-admin-1",
      email: "admin@efficiency-st.com",
      firstName: "Admin",
      lastName: "User",
      profileImageUrl: null,
    }).onConflictDoNothing().returning();

    if (adminUser) {
      await db.insert(userProfiles).values({ userId: "seed-admin-1", role: "ADMIN" }).onConflictDoNothing();
    }

    const [bryanUser] = await db.insert(users).values({
      id: "coach-bryan",
      email: "bryan.jones@efficiencystrengthtraining.com",
      firstName: "Bryan",
      lastName: "Jones",
      profileImageUrl: null,
    }).onConflictDoNothing().returning();

    const [hunterUser] = await db.insert(users).values({
      id: "coach-hunter",
      email: "hunter.thaxton@efficiencystrengthtraining.com",
      firstName: "Hunter",
      lastName: "Thaxton",
      profileImageUrl: null,
    }).onConflictDoNothing().returning();

    if (bryanUser) {
      await db.insert(userProfiles).values({ userId: "coach-bryan", role: "COACH" }).onConflictDoNothing();
      const bryanHash = await bcrypt.hash("21595!Jonsey", 10);
      await db.insert(coachProfiles).values({
        userId: "coach-bryan",
        email: "bryan.jones@efficiencystrengthtraining.com",
        passwordHash: bryanHash,
        bio: "Head strength & conditioning coach specializing in athletic performance development.",
        specialties: ["Strength & Conditioning", "Sports Performance"],
        timezone: "America/New_York",
        isActive: true,
      }).onConflictDoNothing();
    }

    if (hunterUser) {
      await db.insert(userProfiles).values({ userId: "coach-hunter", role: "COACH" }).onConflictDoNothing();
      const hunterHash = await bcrypt.hash("est!2026", 10);
      await db.insert(coachProfiles).values({
        userId: "coach-hunter",
        email: "hunter.thaxton@efficiencystrengthtraining.com",
        passwordHash: hunterHash,
        bio: "Strength & conditioning coach focused on developing well-rounded athletes.",
        specialties: ["Strength & Conditioning", "Athletic Development"],
        timezone: "America/New_York",
        isActive: true,
      }).onConflictDoNothing();
    }

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

    console.log("Database seeded successfully!");
  } catch (error) {
    console.error("Error seeding database:", error);
  }
}
