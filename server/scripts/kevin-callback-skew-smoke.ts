/**
 * Smoke: KEVIN_CALLBACK_ALLOWED_SKEW_SECONDS parse + verify path uses env skew.
 *
 *   set -a && source .env.kevin.local && set +a
 *   npx tsx server/scripts/kevin-callback-skew-smoke.ts
 */
import {
  getKevinCallbackAllowedSkewSeconds,
  getKevinOutboundAuthStatus,
  signKevinCallbackBody,
  verifyKevinCallbackHeaders,
  parseKevinSkewSeconds,
  KEVIN_CALLBACK_DEFAULT_SKEW_SEC,
} from "../services/kevin-outbound-auth";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL", msg);
    process.exit(1);
  }
}

function main() {
  assert(parseKevinSkewSeconds(undefined) === 300, "default 300");
  assert(parseKevinSkewSeconds("") === 300, "empty");
  assert(parseKevinSkewSeconds("120") === 120, "parse 120");
  assert(parseKevinSkewSeconds("5") === 30, "clamp min 30");
  assert(parseKevinSkewSeconds("99999") === 3600, "clamp max 3600");
  assert(parseKevinSkewSeconds("nope") === 300, "invalid");

  const skew = getKevinCallbackAllowedSkewSeconds(process.env);
  const status = getKevinOutboundAuthStatus();
  assert(status.allowedSkewSeconds === skew, "status mirrors skew");
  assert(skew >= 30 && skew <= 3600, "skew in range");

  if (!status.hmacConfigured) {
    console.log(JSON.stringify({ ok: true, skewOnly: true, allowedSkewSeconds: skew }));
    return;
  }

  const body = JSON.stringify({ type: "kevin.skew.smoke" });
  const now = Math.floor(Date.now() / 1000);
  const { headers } = signKevinCallbackBody(body, { timestampSec: now - (skew + 5) });
  const stale = verifyKevinCallbackHeaders({
    rawBody: body,
    timestampHeader: headers["x-kevin-timestamp"],
    signatureHeader: headers["x-kevin-signature"],
    nowSec: now,
  });
  assert(!stale.ok && (stale as any).code === "STALE_TIMESTAMP", "stale rejected");

  const fresh = signKevinCallbackBody(body, { timestampSec: now });
  const ok = verifyKevinCallbackHeaders({
    rawBody: body,
    timestampHeader: fresh.headers["x-kevin-timestamp"],
    signatureHeader: fresh.headers["x-kevin-signature"],
    nowSec: now,
  });
  assert(ok.ok, "fresh accepted");

  console.log(
    JSON.stringify(
      {
        ok: true,
        envRaw: process.env.KEVIN_CALLBACK_ALLOWED_SKEW_SECONDS ?? null,
        allowedSkewSeconds: skew,
        defaultSkew: KEVIN_CALLBACK_DEFAULT_SKEW_SEC,
        staleRejected: true,
        freshAccepted: true,
      },
      null,
      2,
    ),
  );
}

main();
