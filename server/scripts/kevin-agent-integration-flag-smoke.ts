/**
 * Smoke: KEVIN_AGENT_INTEGRATION_ENABLED resolve (OR with legacy).
 *
 *   set -a && source .env.kevin.local && set +a
 *   npx tsx server/scripts/kevin-agent-integration-flag-smoke.ts
 */
import {
  getKevinConfig,
  isKevinAgentIntegrationEnabled,
  isKevinIntegrationEnabled,
  resolveKevinIntegrationEnabled,
} from "../services/kevin-hermes-client";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL", msg);
    process.exit(1);
  }
}

function main() {
  // Unit-ish: preferred alone
  assert(
    resolveKevinIntegrationEnabled({ KEVIN_AGENT_INTEGRATION_ENABLED: "true" }).enabled,
    "agent true",
  );
  assert(
    resolveKevinIntegrationEnabled({ KEVIN_AGENT_INTEGRATION_ENABLED: "true" }).source ===
      "KEVIN_AGENT_INTEGRATION_ENABLED",
    "agent source",
  );
  // legacy alone
  assert(
    resolveKevinIntegrationEnabled({ KEVIN_INTEGRATION_ENABLED: "true" }).enabled,
    "legacy true",
  );
  assert(
    resolveKevinIntegrationEnabled({ KEVIN_INTEGRATION_ENABLED: "yes" }).source ===
      "KEVIN_INTEGRATION_ENABLED",
    "legacy source",
  );
  // both off
  assert(!resolveKevinIntegrationEnabled({}).enabled, "default off");
  // preferred wins as source when both on
  assert(
    resolveKevinIntegrationEnabled({
      KEVIN_AGENT_INTEGRATION_ENABLED: "true",
      KEVIN_INTEGRATION_ENABLED: "true",
    }).source === "KEVIN_AGENT_INTEGRATION_ENABLED",
    "preferred source when both",
  );

  const live = resolveKevinIntegrationEnabled(process.env);
  const cfg = getKevinConfig();
  assert(cfg.integrationEnabled === live.enabled, "config match");
  assert(cfg.integrationFlagSource === live.source, "source match");
  assert(isKevinIntegrationEnabled() === live.enabled, "isKevinIntegrationEnabled");
  assert(isKevinAgentIntegrationEnabled() === live.enabled, "alias");

  console.log(
    JSON.stringify(
      {
        ok: true,
        envAgent: process.env.KEVIN_AGENT_INTEGRATION_ENABLED ?? null,
        envLegacy: process.env.KEVIN_INTEGRATION_ENABLED ?? null,
        enabled: live.enabled,
        source: live.source,
      },
      null,
      2,
    ),
  );
}

main();
