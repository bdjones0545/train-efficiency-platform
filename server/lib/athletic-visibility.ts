import type { OrgAuthContext } from "../org-auth";

const STAFF_ROLES = ["admin", "coach", "staff", "owner"];

/** True when `auth` is staff of `organizationId`. */
export function isAthleticStaff(auth: OrgAuthContext | null, organizationId: string): boolean {
  return !!auth && auth.orgId === organizationId && STAFF_ROLES.includes(auth.role);
}

/**
 * Booking fields a caller who is not staff of the owning organization may see.
 *
 * The public program calendar is anonymous by design — it has to show which
 * slots are taken — but it does not need to know *who* booked them. The
 * booker's name, email and account id are withheld and replaced by two
 * booleans the UI actually consumes.
 */
export interface PublicAthleticBooking {
  id: string;
  organizationId: string;
  programId: string;
  date: string;
  timeSlot: string;
  teamName: string;
  trainingType: string;
  recurrenceId: string | null;
  createdAt: Date | null;
  /** The booking was made by a signed-in member (drives a badge, not identity). */
  hasAccount: boolean;
  /** Mirrors the authorization the DELETE route enforces. */
  canCancel: boolean;
}

type AthleticBookingRow = {
  id: string;
  organizationId: string;
  programId: string;
  date: string;
  timeSlot: string;
  teamName: string;
  trainingType: string;
  bookedBy?: string | null;
  orgUserId?: string | null;
  bookerEmail?: string | null;
  recurrenceId?: string | null;
  createdAt?: Date | null;
};

/**
 * Projects athletic bookings for the requesting viewer.
 *
 * Staff of the owning organization see the full row. Everyone else — including
 * anonymous visitors and members of other organizations — sees the public
 * projection above.
 *
 * `canCancel` is computed with the same rule the DELETE route enforces, so the
 * UI cannot offer a cancel the server will refuse, and cannot hide one it
 * would allow.
 */
export function projectAthleticBooking(
  row: AthleticBookingRow,
  auth: OrgAuthContext | null,
): AthleticBookingRow | PublicAthleticBooking {
  const staff = isAthleticStaff(auth, row.organizationId);
  const isBooker =
    !!auth &&
    auth.orgId === row.organizationId &&
    !!row.orgUserId &&
    auth.userId === row.orgUserId;

  if (staff) return { ...row, canCancel: true } as AthleticBookingRow;

  return {
    id: row.id,
    organizationId: row.organizationId,
    programId: row.programId,
    date: row.date,
    timeSlot: row.timeSlot,
    teamName: row.teamName,
    trainingType: row.trainingType,
    recurrenceId: row.recurrenceId ?? null,
    createdAt: row.createdAt ?? null,
    hasAccount: !!row.orgUserId,
    canCancel: isBooker,
  };
}

export function projectAthleticBookings(
  rows: AthleticBookingRow[],
  auth: OrgAuthContext | null,
): (AthleticBookingRow | PublicAthleticBooking)[] {
  return rows.map((row) => projectAthleticBooking(row, auth));
}
