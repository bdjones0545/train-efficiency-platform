import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

// Session storage table.
// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)]
);

// User storage table.
// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  passwordHash: text("password_hash"),
  profileImageUrl: varchar("profile_image_url"),
  phone: varchar("phone"),
  notes: text("notes"),
  balanceCents: integer("balance_cents").notNull().default(0),
  stripeCustomerId: varchar("stripe_customer_id"),
  lastSignInAt: timestamp("last_sign_in_at"),
  weeklyReminderEnabled: boolean("weekly_reminder_enabled").notNull().default(true),
  lastReminderSentAt: timestamp("last_reminder_sent_at"),
  passwordResetToken: varchar("password_reset_token"),
  passwordResetTokenExpires: timestamp("password_reset_token_expires"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
