import crypto from "crypto";

/**
 * Hashes a raw bearer auth token for storage and lookup.
 *
 * Bearer tokens issued by createAuthToken() are high-entropy random values, so a
 * single unsalted SHA-256 is sufficient to make the stored value non-reversible:
 * a database read (backup leak, insider, SQLi elsewhere) no longer yields usable
 * tokens. The raw token is only ever held by the client; the DB stores this hash.
 *
 * This MUST be used consistently at every write, read, and delete of auth_tokens.
 */
export function hashAuthToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}
