/**
 * Kevin ↔ Hermes shared contracts (Phase 0: health + capabilities only).
 * Keep Zod-free for Phase 0 to avoid package surface changes; Phase 2 will
 * add Zod in shared/kevin/schemas.ts when runs land.
 */

export type KevinHealthStatus =
  | "healthy"
  | "degraded"
  | "down"
  | "unconfigured";

export interface KevinHealth {
  status: KevinHealthStatus;
  hermesReachable: boolean;
  integrationEnabled: boolean;
  configured: boolean;
  gatewayState?: string | null;
  activeRuns?: number | null;
  modelConfigured?: boolean | null;
  features?: {
    runs: boolean;
    sse: boolean;
    approvals: boolean;
  } | null;
  lastError?: string | null;
  checkedAt: string;
  baseUrlRedacted?: string | null;
}

export interface KevinCapabilities {
  status: KevinHealthStatus;
  hermes?: Record<string, unknown> | null;
  teFeatureFlags: {
    integrationEnabled: boolean;
    coachAccess: "none";
    phase: "2";
  };
  checkedAt: string;
  error?: string | null;
}
