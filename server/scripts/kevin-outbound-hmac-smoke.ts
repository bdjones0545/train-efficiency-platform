/**
 * Smoke: resolve + round-trip sign/verify for Kevin→TE callback HMAC mapping.
 * Prefer KEVIN_CALLBACK_HMAC_SECRET; falls back to outbound/legacy aliases.
 * Never prints secret values — presence + fingerprint only.
 *
 * Usage (from repo root):
 *   set -a && source .env.kevin.local && set +a
 *   npx tsx server/scripts/kevin-outbound-hmac-smoke.ts
 */
import { createHash } from "crypto";
import {
  getKevinOutboundAuthStatus,
  getKevinCallbackHmacSecret,
  signKevinCallbackBody,
  verifyKevinCallbackHeaders,
} from "../services/kevin-outbound-auth";

function fp(v: string): string {
  return createHash("sha256").update(v, "utf8").digest("hex").slice(0, 16);
}

async function main() {
  const status = getKevinOutboundAuthStatus();
  const secret = getKevinCallbackHmacSecret();
  console.log(
    JSON.stringify(
      {
        hmacConfigured: status.hmacConfigured,
        hmacEnvName: status.hmacEnvName,
        serviceTokenConfigured: status.serviceTokenConfigured,
        secretPresent: Boolean(secret),
        secretLen: secret ? secret.length : 0,
        fingerprint: secret ? fp(secret) : null,
      },
      null,
      2,
    ),
  );

  if (!secret) {
    console.error(
      "FAIL: no KEVIN_CALLBACK_HMAC_SECRET / KEVIN_OUTBOUND_HMAC_SECRET / legacy alias",
    );
    process.exit(1);
  }

  const body = JSON.stringify({ type: "kevin.callback.smoke", at: new Date().toISOString() });
  const { headers } = signKevinCallbackBody(body);
  const verified = verifyKevinCallbackHeaders({
    rawBody: body,
    timestampHeader: headers["x-kevin-timestamp"],
    signatureHeader: headers["x-kevin-signature"],
  });
  if (!verified.ok) {
    console.error("FAIL verify", verified);
    process.exit(1);
  }
  console.log(JSON.stringify({ roundTrip: "ok", headersPresent: Object.keys(headers) }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
