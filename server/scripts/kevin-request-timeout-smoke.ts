/**
 * Smoke: KEVIN_REQUEST_TIMEOUT_MS parse + config surface (no secrets printed).
 *
 *   set -a && source .env.kevin.local && set +a
 *   npx tsx server/scripts/kevin-request-timeout-smoke.ts
 */
import {
  getKevinConfig,
  getKevinRequestTimeoutMs,
  getKevinRunCreateTimeoutMs,
  parseKevinTimeoutMs,
} from "../services/kevin-hermes-client";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL", msg);
    process.exit(1);
  }
}

function main() {
  assert(parseKevinTimeoutMs(undefined, 8000) === 8000, "default fallback");
  assert(parseKevinTimeoutMs("", 8000) === 8000, "empty fallback");
  assert(parseKevinTimeoutMs("15000", 8000) === 15000, "parse 15000");
  assert(parseKevinTimeoutMs("500", 8000) === 1000, "clamp min");
  assert(parseKevinTimeoutMs("999999", 8000) === 120000, "clamp max");
  assert(parseKevinTimeoutMs("nope", 8000) === 8000, "invalid fallback");

  const req = getKevinRequestTimeoutMs();
  const run = getKevinRunCreateTimeoutMs();
  const cfg = getKevinConfig();

  assert(req >= 1000 && req <= 120000, "request in range");
  assert(run >= 30000 && run >= req, "run-create floor");
  assert(cfg.requestTimeoutMs === req, "config mirrors request timeout");

  console.log(
    JSON.stringify(
      {
        ok: true,
        envRaw: process.env.KEVIN_REQUEST_TIMEOUT_MS ?? null,
        requestTimeoutMs: req,
        runCreateTimeoutMs: run,
        configRequestTimeoutMs: cfg.requestTimeoutMs,
      },
      null,
      2,
    ),
  );
}

main();
