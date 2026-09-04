/**
 * Projection for booking participants.
 *
 * `storage.getBookingParticipants` joins the whole `users` row, because most
 * of its callers need it — sending confirmation email, matching a phone
 * number, checking a balance. Exactly one caller serializes the result to a
 * response, and that route was returning the join verbatim: password hashes,
 * live password reset tokens, email, phone, notes, Stripe customer ids.
 *
 * The user shape here is an ALLOWLIST rather than a denylist. A denylist is
 * the wrong default against the users table — a column added later would ship
 * to anonymous callers until someone remembered to exclude it.
 */

/** The only user fields any participant roster renders. */
const PUBLIC_USER_FIELDS = ["id", "firstName", "lastName", "profileImageUrl"] as const;

/** The only participant fields the roster needs. */
const PUBLIC_PARTICIPANT_FIELDS = ["id", "bookingId", "userId", "participantName", "joinedAt"] as const;

export interface PublicParticipantUser {
  id: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
}

export interface PublicParticipant {
  id: string | null;
  bookingId: string | null;
  userId: string | null;
  participantName: string | null;
  joinedAt: Date | null;
  user: PublicParticipantUser | null;
}

function pick<T extends readonly string[]>(
  source: Record<string, any> | null | undefined,
  fields: T,
): Record<string, any> | null {
  if (!source) return null;
  const result: Record<string, any> = {};
  for (const field of fields) result[field] = source[field] ?? null;
  return result;
}

/** Projects one participant, including its joined user, down to the allowlists. */
export function toPublicParticipant(participant: Record<string, any>): PublicParticipant {
  const base = pick(participant, PUBLIC_PARTICIPANT_FIELDS) as Record<string, any>;
  base.user = pick(participant?.user, PUBLIC_USER_FIELDS);
  return base as PublicParticipant;
}

export function toPublicParticipants(participants: Record<string, any>[]): PublicParticipant[] {
  return (participants ?? []).map(toPublicParticipant);
}
