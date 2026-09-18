/**
 * Projection for coach profiles served to anonymous callers.
 *
 * `storage.getCoachProfilesByOrganization` and `storage.getCoachProfile` join
 * the whole `users` row onto each coach because their authenticated callers
 * need it (the admin configuration page renders `coach.user.email`). The
 * public org landing page (`GET /api/organizations/:slug/coaches`) was
 * returning that join verbatim: the coach's `passwordHash` and `coachEmail`,
 * plus the user's `passwordHash`, `email`, `phone`, `passwordResetToken`,
 * `stripeCustomerId`, `unsubscribeToken` and every other column.
 *
 * The top-level denylist matches what `/api/coaches` and `/api/coaches/:id`
 * strip, so the three routes agree on the coach shape. The nested user is an
 * ALLOWLIST — the landing page renders exactly the name and photo, and a
 * users column added later must not ship to anonymous callers by default.
 */

/** The coach_profiles columns `/api/coaches` already removes before responding. */
const COACH_SECRET_FIELDS = ["passwordHash", "email"] as const;

/** The only user fields a public coach card renders. */
const PUBLIC_COACH_USER_FIELDS = ["firstName", "lastName", "profileImageUrl"] as const;

export interface PublicCoachUser {
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
}

export type PublicCoach<T extends Record<string, any>> = Omit<T, "passwordHash" | "email" | "user"> & {
  user: PublicCoachUser | null;
};

function pickUser(user: Record<string, any> | null | undefined): PublicCoachUser | null {
  if (!user) return null;
  const result: Record<string, any> = {};
  for (const field of PUBLIC_COACH_USER_FIELDS) result[field] = user[field] ?? null;
  return result as PublicCoachUser;
}

/** Projects one coach, including its joined user, down to the public shape. */
export function toPublicCoach<T extends Record<string, any>>(coach: T): PublicCoach<T> {
  const safe: Record<string, any> = { ...coach };
  for (const field of COACH_SECRET_FIELDS) delete safe[field];
  safe.user = pickUser(coach.user);
  return safe as PublicCoach<T>;
}

export function toPublicCoaches<T extends Record<string, any>>(coaches: T[]): PublicCoach<T>[] {
  return (coaches ?? []).map(toPublicCoach);
}
