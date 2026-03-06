import { db } from "./db";
import { services, bookings } from "@shared/schema";
import { eq, isNull, and, inArray } from "drizzle-orm";

export async function fixServiceTypes() {
  try {
    const groupKeywords = ["semi-private", "team training", "group", "partner training"];

    const allServices = await db.select().from(services);
    const fixedServiceIds: string[] = [];

    for (const service of allServices) {
      const nameLower = service.name.toLowerCase();
      const shouldBeGroup = groupKeywords.some(kw => nameLower.includes(kw));

      if (shouldBeGroup && service.sessionType !== "GROUP") {
        await db.update(services)
          .set({ sessionType: "GROUP" as any })
          .where(eq(services.id, service.id));
        fixedServiceIds.push(service.id);
        console.log(`[Fix Service Types] Updated "${service.name}" from ${service.sessionType} to GROUP`);
      }
    }

    if (fixedServiceIds.length > 0) {
      const updated = await db.update(bookings)
        .set({ maxParticipants: 6 })
        .where(
          and(
            inArray(bookings.serviceId, fixedServiceIds),
            isNull(bookings.maxParticipants)
          )
        )
        .returning({ id: bookings.id });
      if (updated.length > 0) {
        console.log(`[Fix Service Types] Set maxParticipants=6 on ${updated.length} existing bookings`);
      }
    }
  } catch (error) {
    console.error("[Fix Service Types] Error:", error);
  }
}
