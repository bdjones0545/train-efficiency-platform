/**
 * Phase 0 smoke checks for KevinHermesClient (no Express boot).
 *
 * Usage (from train-efficiency-platform root, with deps installed):
 *   set -a && source .env.kevin.local && set +a
 *   npx tsx server/scripts/kevin-phase0-smoke.ts
 *
 * Or: node --import tsx server/scripts/kevin-phase0-smoke.ts
 */

import {
  getKevinConfig,
  getKevinHealth,
  getKevinCapabilitiesView,
} from "../services/kevin-hermes-client";

async function main() {
  const cfg = getKevinConfig();
  console.log("config", {
    integrationEnabled: cfg.integrationEnabled,
    configured: cfg.configured,
    baseUrlRedacted: cfg.baseUrlRedacted,
  });

  const health = await getKevinHealth();
  console.log("health.status", health.status);
  console.log("health.hermesReachable", health.hermesReachable);
  console.log("health.lastError", health.lastError);

  const caps = await getKevinCapabilitiesView();
  console.log("capabilities.status", caps.status);
  console.log("capabilities.model", (caps.hermes as any)?.model);
  console.log("teFeatureFlags", caps.teFeatureFlags);

  if (!cfg.integrationEnabled || !cfg.configured) {
    if (health.status !== "unconfigured") {
      console.error("FAIL: expected unconfigured when disabled/missing secrets");
      process.exit(1);
    }
    console.log("PASS unconfigured path");
    return;
  }

  if (health.status === "down") {
    console.error("FAIL: hermes down");
    process.exit(1);
  }
  console.log("PASS phase0 smoke");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
