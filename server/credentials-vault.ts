import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";

/**
 * Derives a 256-bit key from SESSION_SECRET (or a dev fallback).
 * In production, set SESSION_SECRET to a long random string.
 */
function getDerivedKey(): Buffer {
  const secret =
    process.env.CREDENTIAL_ENCRYPTION_KEY ||
    process.env.SESSION_SECRET ||
    "dev-fallback-key-not-for-production!!";
  return crypto.createHash("sha256").update(String(secret)).digest();
}

/**
 * Encrypts a credentials object with AES-256-GCM.
 * Returns a JSON-serialisable object safe to store in a jsonb column.
 */
export function encryptCredentials(
  credentials: Record<string, string>
): Record<string, unknown> {
  const key = getDerivedKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const plaintext = JSON.stringify(credentials);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    _v: 1,
    _enc: encrypted.toString("base64"),
    _iv: iv.toString("base64"),
    _tag: tag.toString("base64"),
  };
}

/**
 * Decrypts a stored credential envelope back to the original key/value map.
 * Returns null if the envelope is missing, malformed, or decryption fails.
 */
export function decryptCredentials(
  stored: Record<string, unknown> | null | undefined
): Record<string, string> | null {
  if (!stored || stored._v !== 1) return null;
  try {
    const key = getDerivedKey();
    const iv = Buffer.from(stored._iv as string, "base64");
    const tag = Buffer.from(stored._tag as string, "base64");
    const encData = Buffer.from(stored._enc as string, "base64");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encData), decipher.final()]);
    return JSON.parse(decrypted.toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Produces masked hints for display: ••••••••{last4}.
 * Safe to return to the frontend — no recoverable secret information.
 */
export function computeCredentialHints(
  credentials: Record<string, string>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(credentials).map(([key, value]) => {
      if (!value) return [key, ""];
      const last4 = value.slice(-4);
      return [key, "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" + last4];
    })
  );
}
