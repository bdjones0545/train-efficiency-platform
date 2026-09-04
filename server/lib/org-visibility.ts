import { resolveOrgIdOrThrow } from "./resolve-org-id";

/**
 * Organization fields that must never reach a caller who is not a member of
 * that organization.
 *
 * `stripeSecretKey` is stripped everywhere (including for members) by the
 * route handlers themselves and is listed here as a backstop.
 */
const MEMBER_ONLY_ORG_FIELDS = [
  "ownerEmail",
  "ownerUserId",
  "stripeSecretKey",
  "stripePublishableKey",
  "stripeCustomerId",
  "stripeSubscriptionId",
  "subscriptionStatus",
  "subscriptionCurrentPeriodEnd",
  "trialEndsAt",
  "schedulingInquiryEmail",
  "schedulingInquiryName",
  "automationLevel",
] as const;

/**
 * Fields the public organization directory (/portal) is allowed to see.
 * Allowlist rather than denylist — the directory enumerates every tenant, so
 * a new column must never be exposed there by default.
 */
const PUBLIC_DIRECTORY_ORG_FIELDS = [
  "id",
  "name",
  "slug",
  "logoUrl",
  "primaryColor",
  "tagline",
] as const;

/**
 * Strips member-only fields from an organization row.
 *
 * Public org pages (booking, athletic scheduling, org portal) legitimately
 * read branding and feature flags anonymously, so this is a denylist — only
 * owner identity, billing and Stripe configuration are removed.
 */
export function toPublicOrg<T extends Record<string, any>>(org: T): Partial<T> {
  const safe: Record<string, any> = { ...org };
  for (const field of MEMBER_ONLY_ORG_FIELDS) delete safe[field];
  return safe as Partial<T>;
}

/** Projects an organization row down to the public directory allowlist. */
export function toDirectoryOrg<T extends Record<string, any>>(org: T): Partial<T> {
  const safe: Record<string, any> = {};
  for (const field of PUBLIC_DIRECTORY_ORG_FIELDS) safe[field] = org[field];
  return safe as Partial<T>;
}

/**
 * Resolves the caller's organization without throwing.
 *
 * Returns null for anonymous callers and for authenticated users who have no
 * resolvable organization.
 */
export async function resolveOrgIdOrNull(req: any): Promise<string | null> {
  try {
    return await resolveOrgIdOrThrow(req);
  } catch {
    return null;
  }
}

/** True when the caller is an authenticated member of `orgId`. */
export async function isOrgMember(req: any, orgId: string): Promise<boolean> {
  const callerOrgId = await resolveOrgIdOrNull(req);
  return !!callerOrgId && callerOrgId === orgId;
}
