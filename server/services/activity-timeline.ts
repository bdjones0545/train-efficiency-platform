import { db } from "../db";
import { orgActivityEvents } from "@shared/schema";
import { eq, and, gte, lte, desc, inArray } from "drizzle-orm";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ActivitySourceType =
  | "booking" | "workout" | "readiness" | "pr" | "alert" | "message" | "intelligence" | "system";

export type ActivityVisibility = "athlete" | "coach" | "owner";

export interface ActivityEventInput {
  orgId: string;
  userId?: string;
  teamId?: string;
  sourceType: ActivitySourceType;
  sourceId?: string;
  eventType: string;
  title: string;
  description?: string;
  eventDate?: Date;
  metadata?: Record<string, any>;
  visibility?: ActivityVisibility;
}

// ─── Source type config (colors + icons used on frontend) ─────────────────────

export const SOURCE_CONFIG: Record<ActivitySourceType, { color: string; icon: string; label: string }> = {
  booking:      { color: "blue",    icon: "Calendar",       label: "Booking" },
  workout:      { color: "green",   icon: "Dumbbell",       label: "Workout" },
  readiness:    { color: "rose",    icon: "Heart",          label: "Readiness" },
  pr:           { color: "amber",   icon: "Trophy",         label: "PR" },
  alert:        { color: "orange",  icon: "Zap",            label: "Alert" },
  message:      { color: "violet",  icon: "MessageSquare",  label: "Message" },
  intelligence: { color: "cyan",    icon: "TrendingUp",     label: "Intelligence" },
  system:       { color: "muted",   icon: "Bell",           label: "System" },
};

// ─── Core helper ───────────────────────────────────────────────────────────────

export async function createActivityEvent(input: ActivityEventInput): Promise<string> {
  try {
    const [event] = await db.insert(orgActivityEvents).values({
      orgId: input.orgId,
      userId: input.userId ?? null,
      teamId: input.teamId ?? null,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      eventType: input.eventType,
      title: input.title,
      description: input.description ?? null,
      eventDate: input.eventDate ?? new Date(),
      metadata: (input.metadata ?? {}) as any,
      visibility: input.visibility ?? "athlete",
    }).returning();
    return event.id;
  } catch (err: any) {
    console.error("[activity-timeline] createActivityEvent error:", err?.message);
    return "";
  }
}

// ─── Query helpers ─────────────────────────────────────────────────────────────

export interface ActivityQueryOptions {
  orgId: string;
  userId?: string;
  teamId?: string;
  sourceType?: ActivitySourceType | ActivitySourceType[];
  startDate?: Date;
  endDate?: Date;
  visibility?: ActivityVisibility[];
  limit?: number;
  offset?: number;
}

export async function queryActivityEvents(opts: ActivityQueryOptions) {
  const {
    orgId, userId, teamId, sourceType, startDate, endDate,
    visibility, limit: lim = 100, offset: off = 0,
  } = opts;

  const conds: any[] = [eq(orgActivityEvents.orgId, orgId)];
  if (userId) conds.push(eq(orgActivityEvents.userId, userId));
  if (teamId) conds.push(eq(orgActivityEvents.teamId, teamId));
  if (sourceType) {
    if (Array.isArray(sourceType)) {
      conds.push(inArray(orgActivityEvents.sourceType, sourceType));
    } else {
      conds.push(eq(orgActivityEvents.sourceType, sourceType));
    }
  }
  if (startDate) conds.push(gte(orgActivityEvents.eventDate, startDate));
  if (endDate)   conds.push(lte(orgActivityEvents.eventDate, endDate));
  if (visibility) conds.push(inArray(orgActivityEvents.visibility, visibility));

  return db.select().from(orgActivityEvents)
    .where(and(...conds))
    .orderBy(desc(orgActivityEvents.eventDate))
    .limit(lim)
    .offset(off);
}

// ─── Calendar view: group events by date ──────────────────────────────────────

export function groupEventsByDate(events: any[]) {
  const groups = new Map<string, any[]>();
  for (const ev of events) {
    const d = new Date(ev.eventDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(ev);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, items]) => ({ date, items }));
}
