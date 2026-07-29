/**
 * kevin-agent-config.ts — Environment configuration for Kevin agent integration.
 *
 * Never exposed to the browser. Validates required config on startup when enabled.
 * Fails safely (does not throw) when the integration is disabled.
 */

export interface KevinAgentConfig {
  enabled: boolean;
  gatewayBaseUrl: string;
  outboundHmacSecret: string;
  callbackHmacSecret: string;
  requestTimeoutMs: number;
  callbackAllowedSkewSeconds: number;
  callbackBaseUrl: string;
}

let _validated = false;

export function getKevinAgentConfig(): KevinAgentConfig {
  const enabled =
    process.env.KEVIN_AGENT_INTEGRATION_ENABLED === "true" ||
    process.env.KEVIN_AGENT_INTEGRATION_ENABLED === "1";

  return {
    enabled,
    gatewayBaseUrl: process.env.KEVIN_GATEWAY_BASE_URL ?? "",
    outboundHmacSecret: process.env.KEVIN_OUTBOUND_HMAC_SECRET ?? "",
    callbackHmacSecret: process.env.KEVIN_CALLBACK_HMAC_SECRET ?? "",
    requestTimeoutMs: parseInt(process.env.KEVIN_REQUEST_TIMEOUT_MS ?? "30000", 10) || 30000,
    callbackAllowedSkewSeconds:
      parseInt(process.env.KEVIN_CALLBACK_ALLOWED_SKEW_SECONDS ?? "300", 10) || 300,
    callbackBaseUrl:
      process.env.KEVIN_CALLBACK_BASE_URL ??
      (process.env.REPLIT_DEV_DOMAIN
        ? `https://${process.env.REPLIT_DEV_DOMAIN}`
        : "http://localhost:5000"),
  };
}

/**
 * Called once at startup if integration is enabled.
 * Throws if required secrets are missing. Does nothing if disabled.
 */
export function validateKevinAgentConfig(): void {
  if (_validated) return;
  const cfg = getKevinAgentConfig();

  if (!cfg.enabled) {
    console.log(
      JSON.stringify({
        event: "KEVIN_AGENT_INTEGRATION_DISABLED",
        message: "Kevin agent integration is disabled. Set KEVIN_AGENT_INTEGRATION_ENABLED=true to enable.",
        timestamp: new Date().toISOString(),
      }),
    );
    _validated = true;
    return;
  }

  const missing: string[] = [];
  if (!cfg.gatewayBaseUrl) missing.push("KEVIN_GATEWAY_BASE_URL");
  if (!cfg.outboundHmacSecret) missing.push("KEVIN_OUTBOUND_HMAC_SECRET");
  if (!cfg.callbackHmacSecret) missing.push("KEVIN_CALLBACK_HMAC_SECRET");

  if (missing.length > 0) {
    throw new Error(
      `Kevin agent integration is enabled but missing required environment variables: ${missing.join(", ")}`,
    );
  }

  console.log(
    JSON.stringify({
      event: "KEVIN_AGENT_INTEGRATION_CONFIG_VALID",
      gatewayBaseUrl: cfg.gatewayBaseUrl,
      requestTimeoutMs: cfg.requestTimeoutMs,
      callbackAllowedSkewSeconds: cfg.callbackAllowedSkewSeconds,
      timestamp: new Date().toISOString(),
    }),
  );
  _validated = true;
}

/** Returns true if integration is enabled and fully configured. */
export function isKevinAgentReady(): boolean {
  const cfg = getKevinAgentConfig();
  return (
    cfg.enabled &&
    !!cfg.gatewayBaseUrl &&
    !!cfg.outboundHmacSecret &&
    !!cfg.callbackHmacSecret
  );
}
