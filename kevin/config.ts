/**
 * Kevin → TrainEfficiency Access Plane — Step 2
 *
 * Configuration loaded exclusively from environment variables.
 * Fails closed (throws) when required credentials are missing.
 * No secret values are logged, committed, or stored in memory.
 *
 * Environment variables required:
 *   TE_INTERNAL_SERVICE_TOKEN          — bearer token for M2M auth (secret)
 *   TRAINEFFICIENCY_KEVIN_SIGNING_SECRET — HMAC signing secret (secret)
 *   TRAINEFFICIENCY_BASE_URL           — base URL of TE control plane
 *   TRAINEFFICIENCY_KEVIN_SERVICE_ID   — Kevin's service identity string
 *   TRAINEFFICIENCY_KEVIN_KEY_ID       — key ID for signing key rotation
 *   TRAINEFFICIENCY_DEFAULT_ORG_ID     — default org scope for Kevin operations
 *   TRAINEFFICIENCY_REQUEST_TIMEOUT_MS — request timeout in ms (default: 30000)
 */

export interface TeConfig {
  baseUrl: string;
  serviceId: string;
  keyId: string;
  defaultOrgId: string;
  requestTimeoutMs: number;
  /** Bearer token for Authorization header — NEVER log this value */
  readonly bearerToken: string;
  /** HMAC signing secret — NEVER log this value */
  readonly signingSecret: string;
}

export interface CredentialStatus {
  bearerTokenPresent: boolean;
  signingSecretPresent: boolean;
  baseUrlPresent: boolean;
  serviceIdPresent: boolean;
  defaultOrgIdPresent: boolean;
  allRequiredPresent: boolean;
  missingRequired: string[];
}

const REQUIRED_SECRETS = ["TE_INTERNAL_SERVICE_TOKEN", "TRAINEFFICIENCY_KEVIN_SIGNING_SECRET"] as const;
const REQUIRED_VARS    = ["TRAINEFFICIENCY_BASE_URL", "TRAINEFFICIENCY_KEVIN_SERVICE_ID"] as const;

/**
 * Check credential status without exposing values.
 * Safe to log (values are never included).
 */
export function getCredentialStatus(): CredentialStatus {
  const missing: string[] = [];
  for (const k of [...REQUIRED_SECRETS, ...REQUIRED_VARS]) {
    if (!process.env[k]) missing.push(k);
  }
  return {
    bearerTokenPresent:    !!process.env.TE_INTERNAL_SERVICE_TOKEN,
    signingSecretPresent:  !!process.env.TRAINEFFICIENCY_KEVIN_SIGNING_SECRET,
    baseUrlPresent:        !!process.env.TRAINEFFICIENCY_BASE_URL,
    serviceIdPresent:      !!process.env.TRAINEFFICIENCY_KEVIN_SERVICE_ID,
    defaultOrgIdPresent:   !!process.env.TRAINEFFICIENCY_DEFAULT_ORG_ID,
    allRequiredPresent:    missing.length === 0,
    missingRequired:       missing,
  };
}

/**
 * Load configuration. Throws with a descriptive message when required
 * credentials are absent — fails closed, never silently falls back.
 */
export function loadTeConfig(): TeConfig {
  const status = getCredentialStatus();
  if (!status.allRequiredPresent) {
    throw new Error(
      `[Kevin/TE] Missing required credentials: ${status.missingRequired.join(", ")}. ` +
      `Set these environment variables before starting Kevin. Kevin will not start without them.`
    );
  }

  return {
    baseUrl:          process.env.TRAINEFFICIENCY_BASE_URL!.replace(/\/$/, ""),
    serviceId:        process.env.TRAINEFFICIENCY_KEVIN_SERVICE_ID!,
    keyId:            process.env.TRAINEFFICIENCY_KEVIN_KEY_ID ?? "kevin-key-v1",
    defaultOrgId:     process.env.TRAINEFFICIENCY_DEFAULT_ORG_ID ?? "",
    requestTimeoutMs: parseInt(process.env.TRAINEFFICIENCY_REQUEST_TIMEOUT_MS ?? "30000", 10),
    get bearerToken() { return process.env.TE_INTERNAL_SERVICE_TOKEN!; },
    get signingSecret() { return process.env.TRAINEFFICIENCY_KEVIN_SIGNING_SECRET!; },
  };
}

/**
 * Try to load config; returns null instead of throwing.
 * Used by health checks to surface missing-credential errors gracefully.
 */
export function tryLoadTeConfig(): TeConfig | null {
  try { return loadTeConfig(); } catch { return null; }
}

/**
 * Redact a string that may contain sensitive header values.
 * Returns "[REDACTED]" for Authorization and X-Kevin-Signature headers.
 */
export function redactSensitiveHeader(name: string, value: string): string {
  const sensitive = new Set(["authorization", "x-kevin-signature", "x-api-key", "cookie", "set-cookie"]);
  if (sensitive.has(name.toLowerCase())) return "[REDACTED]";
  return value;
}

/** Redact a headers object for safe logging. */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = redactSensitiveHeader(k, v);
  }
  return out;
}
