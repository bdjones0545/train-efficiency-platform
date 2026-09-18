/**
 * `GET /api/coaches` and `GET /api/coaches/:id` are anonymous: the first takes
 * `?organizationId=`, the second takes a coach id. Both used to hand-strip two
 * columns from the coach row (`passwordHash`, `email`) and then return the
 * JOINED `users` row untouched — the coach's login email, password hash, phone,
 * password reset token, Stripe customer id and unsubscribe token included.
 *
 * These tests run the shared projection over a row shaped like the one
 * `storage.getCoachProfilesByOrganization` produces, and check the two routes
 * are actually wired to it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

const { toPublicCoach, toPublicCoaches } = await import("../lib/coach-visibility");

/** Shaped like a `coach_profiles` row with the whole `users` row joined on. */
function coachFixture() {
  return {
    id: "coach-1",
    userId: "user-1",
    organizationId: "org-a",
    bio: "Strength coach",
    specialties: ["olympic lifting"],
    isActive: true,
    payoutPercentage: 60,
    passwordHash: "$2a$10$coachprofilehash",
    email: "coach.login@example.com",
    user: {
      id: "user-1",
      firstName: "Dana",
      lastName: "Reyes",
      profileImageUrl: "https://cdn.example.com/dana.png",
      email: "dana@example.com",
      phone: "+15555550100",
      passwordHash: "$2a$10$usersrowhash",
      passwordResetToken: "reset-token-abc",
      passwordResetExpires: "2026-01-01T00:00:00.000Z",
      stripeCustomerId: "cus_12345",
      unsubscribeToken: "unsub-token-xyz",
      role: "COACH",
    },
  };
}

const SECRET_USER_FIELDS = [
  "passwordHash",
  "email",
  "phone",
  "passwordResetToken",
  "passwordResetExpires",
  "stripeCustomerId",
  "unsubscribeToken",
];

test("the list projection keeps the public coach card fields and nothing else from the joined user", () => {
  const [projected] = toPublicCoaches([coachFixture()]);

  assert.deepEqual(Object.keys(projected.user ?? {}).sort(), [
    "firstName",
    "lastName",
    "profileImageUrl",
  ]);
  for (const field of SECRET_USER_FIELDS) {
    assert.equal(field in (projected.user as any), false, `user.${field} must not ship`);
  }
  assert.equal("passwordHash" in projected, false);
  assert.equal("email" in projected, false);

  // Everything the public booking and org pages render is still present.
  assert.equal(projected.id, "coach-1");
  assert.equal(projected.bio, "Strength coach");
  assert.deepEqual(projected.specialties, ["olympic lifting"]);
  assert.equal(projected.user?.firstName, "Dana");
  assert.equal(projected.user?.profileImageUrl, "https://cdn.example.com/dana.png");
});

test("the single-coach projection behaves identically and survives a missing user join", () => {
  const projected = toPublicCoach(coachFixture());
  for (const field of SECRET_USER_FIELDS) {
    assert.equal(field in (projected.user as any), false, `user.${field} must not ship`);
  }
  assert.equal("passwordHash" in projected, false);
  assert.equal("email" in projected, false);

  const withoutUser = toPublicCoach({ id: "coach-2", passwordHash: "x", email: "y@example.com" });
  assert.equal(withoutUser.user, null);
  assert.equal("passwordHash" in withoutUser, false);
});

test("a users column added later does not ship by default", () => {
  const coach = coachFixture();
  (coach.user as any).ssnLastFour = "1234";
  const projected = toPublicCoach(coach);
  assert.equal("ssnLastFour" in (projected.user as any), false);
});

test("both anonymous coach routes are wired to the projection and no longer hand-strip columns", async () => {
  const source = await readFile(new URL("../routes.ts", import.meta.url), "utf8");

  assert.match(source, /import \{ toPublicCoach, toPublicCoaches \} from "\.\/lib\/coach-visibility";/);
  assert.match(source, /res\.json\(toPublicCoaches\(coaches\)\);/);
  assert.match(source, /res\.json\(toPublicCoach\(coach\)\);/);

  // The old shape: a destructure that removed two columns and returned the rest.
  assert.equal(/const \{ passwordHash, email, \.\.\.safe \} = coach;/.test(source), false);
  assert.equal(/coaches\.map\(\(\{ passwordHash, email, \.\.\.rest \}: any\) => rest\)/.test(source), false);
});

test("the coach contact address is served only from a role-guarded listing", async () => {
  // The coach admin routes live in ./admin-coach-routes.ts, which routes.ts
  // mounts via registerAdminCoachRoutes.
  const source = await readFile(new URL("../admin-coach-routes.ts", import.meta.url), "utf8");
  const registration = source.match(/app\.get\("\/api\/admin\/coaches",([^\n]*)/);
  assert.ok(registration, "GET /api/admin/coaches must exist for the admin screens");
  assert.match(registration[1], /isAuthenticated, requireRole\("COACH", "ADMIN"\)/);
  assert.match(source, /coachEmail: coach\.user\?\.email \?\? coach\.email \?\? null/);
});

test("no client page reads a coach email out of the anonymous listing any more", async () => {
  for (const page of ["admin-configuration.tsx", "attendance-program-editor.tsx"]) {
    const source = await readFile(
      new URL(`../../client/src/pages/${page}`, import.meta.url),
      "utf8",
    );
    assert.equal(/coach\.user\??\.email/.test(source), false, page);
    assert.equal(/c\.user\??\.email/.test(source), false, page);
    assert.match(source, /"\/api\/admin\/coaches"/, page);
  }
});
