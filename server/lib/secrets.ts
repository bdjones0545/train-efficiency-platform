import crypto from "crypto";

/**
 * Centralized, fail-closed access to application secrets.
 *
 * Rules enforced here:
 *   - In production, required secrets MUST be provided via the environment.
 *     Missing secrets throw rather than silently falling back to a committed
 *     default (which would be public and forgeable).
 *   - SESSION_SECRET and CREDENTIAL_ENCRYPTION_KEY are DISTINCT concerns and
 *     must not be the same value (see assertRequiredSecrets).
 *   - In development, clearly-labelled insecure fallbacks keep local dev usable
 *     without weakening production. These fallbacks are only ever reachable when
 *     NODE_ENV !== "production".
 */

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

const DEV_SESSION_SECRET = "dev-only-insecure-session-secret";
const DEV_CREDENTIAL_KEY = "dev-only-insecure-credential-key";

/**
 * SESSION_SECRET — used by express-session and for signing OAuth-state HMACs.
 * Never used to encrypt stored third-party credentials (see getCredentialEncryptionKey).
 */
export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length > 0) return secret;
  if (isProduction()) {
    throw new Error(
      "[secrets] SESSION_SECRET is required in production but is not set.",
    );
  }
  return DEV_SESSION_SECRET;
}

/**
 * Derives the 256-bit AES key for the credentials vault.
 *
 * Sourced ONLY from CREDENTIAL_ENCRYPTION_KEY — intentionally decoupled from
 * SESSION_SECRET so that rotating the session secret cannot render stored
 * credentials undecryptable, and so the two secrets can be managed independently.
 */
export function getCredentialEncryptionKey(): Buffer {
  const key = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (key && key.length > 0) {
    if (isProduction() && key.length < 32) {
      throw new Error(
        "[secrets] CREDENTIAL_ENCRYPTION_KEY must be at least 32 characters in production.",
      );
    }
    return crypto.createHash("sha256").update(key).digest();
  }
  if (isProduction()) {
    throw new Error(
      "[secrets] CREDENTIAL_ENCRYPTION_KEY is required in production but is not set.",
    );
  }
  return crypto.createHash("sha256").update(DEV_CREDENTIAL_KEY).digest();
}

/**
 * Startup guard — call once at boot. In production, fails closed if any required
 * secret is missing, or if SESSION_SECRET and CREDENTIAL_ENCRYPTION_KEY collide.
 * A no-op in development so local dev keeps working.
 */
export function assertRequiredSecrets(): void {
  if (!isProduction()) return;

  const missing: string[] = [];
  if (!process.env.SESSION_SECRET) missing.push("SESSION_SECRET");
  if (!process.env.CREDENTIAL_ENCRYPTION_KEY) missing.push("CREDENTIAL_ENCRYPTION_KEY");
  if (missing.length > 0) {
    throw new Error(
      `[secrets] Missing required production secret(s): ${missing.join(", ")}. ` +
        `Set them in the deployment environment (never in committed files).`,
    );
  }

  if (process.env.SESSION_SECRET === process.env.CREDENTIAL_ENCRYPTION_KEY) {
    throw new Error(
      "[secrets] SESSION_SECRET and CREDENTIAL_ENCRYPTION_KEY must be different values.",
    );
  }
}
