/**
 * Kevin Capability Map — Step 6
 *
 * Live capability registry fetcher.
 * Records all fields required by the spec per capability.
 * Does NOT treat registered-but-disabled capabilities as executable.
 * Does NOT infer that a capability exists merely because a similar platform function exists.
 */

import type { TrainEfficiencyClient, CapabilityRecord } from "./te-client";

export interface MappedCapability {
  key: string;
  version: string;
  description: string;
  category: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  currentEffectiveMode: string;
  permittedRoles: string[];
  approvalPolicy: {
    requiresApprovalAt: string;
    requiresHumanApproval: boolean;
  };
  executor: string;
  verifier: string;
  retryBehavior: {
    maxAttempts: number;
    retryableErrors: string[];
  };
  idempotencyBehavior: {
    idempotent: boolean;
    idempotencyKeyRequired: boolean;
  };
  availability: "available" | "disabled" | "unknown";
  isExecutable: boolean;
  isReversible: boolean;
}

/**
 * Fetch and map all capabilities from the live registry.
 * Returns only capabilities with confirmed existence.
 */
export async function fetchCapabilityMap(
  client: TrainEfficiencyClient,
  orgId: string,
  correlationId?: string,
): Promise<Map<string, MappedCapability>> {
  const { capabilities } = await client.listCapabilities(orgId, correlationId);
  const map = new Map<string, MappedCapability>();

  for (const cap of capabilities) {
    const mapped = mapCapability(cap);
    map.set(cap.key, mapped);
  }

  return map;
}

/**
 * Map a raw CapabilityRecord to a richer MappedCapability with full spec fields.
 */
export function mapCapability(cap: CapabilityRecord): MappedCapability {
  const disabled = cap.defaultMode === "disabled";
  const highRisk = cap.riskLevel === "high" || cap.riskLevel === "critical";

  return {
    key: cap.key,
    version: "1",
    description: cap.description,
    category: cap.category,
    riskLevel: cap.riskLevel as MappedCapability["riskLevel"],
    currentEffectiveMode: cap.defaultMode,
    permittedRoles: cap.permittedRoles ?? [],
    approvalPolicy: {
      requiresApprovalAt: cap.requiresApprovalAt ?? "medium",
      requiresHumanApproval: highRisk,
    },
    executor: cap.executorService ?? "unknown",
    verifier: cap.verificationStrategy ?? "no_verification",
    retryBehavior: {
      maxAttempts: highRisk ? 1 : 2,
      retryableErrors: ["TIMEOUT", "EXECUTOR_UNAVAILABLE", "RATE_LIMITED"],
    },
    idempotencyBehavior: {
      idempotent: cap.idempotent ?? false,
      idempotencyKeyRequired: cap.idempotent === false && highRisk,
    },
    availability: disabled ? "disabled" : "available",
    isExecutable: !disabled,
    isReversible: cap.isReversible ?? true,
  };
}

/**
 * Find the best-matching capability for a natural-language objective.
 * Returns null if no confident match is found — never invents a capability.
 */
export function findCapabilityForObjective(
  capMap: Map<string, MappedCapability>,
  objective: string,
  preferredCategory?: string,
): MappedCapability | null {
  const obj = objective.toLowerCase();
  const candidates: Array<{ cap: MappedCapability; score: number }> = [];

  for (const cap of capMap.values()) {
    if (!cap.isExecutable) continue; // skip disabled

    let score = 0;
    const keyWords = cap.key.replace(/\./g, " ").split(" ");
    const descWords = cap.description.toLowerCase().split(/\s+/);

    for (const word of keyWords) {
      if (obj.includes(word)) score += 3;
    }
    for (const word of descWords) {
      if (word.length > 4 && obj.includes(word)) score += 1;
    }
    if (preferredCategory && cap.category === preferredCategory) score += 2;

    if (score > 0) candidates.push({ cap, score });
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);

  const top = candidates[0];
  // Require confidence threshold — never guess
  if (top.score < 3) return null;

  return top.cap;
}

/**
 * Get all executable capabilities for a given category.
 */
export function getExecutableCapabilitiesForCategory(
  capMap: Map<string, MappedCapability>,
  category: string,
): MappedCapability[] {
  return [...capMap.values()].filter((c) => c.category === category && c.isExecutable);
}

/**
 * Summarize the capability map for logging (no sensitive data).
 */
export function summarizeCapabilityMap(capMap: Map<string, MappedCapability>): {
  total: number;
  executable: number;
  disabled: number;
  byCategory: Record<string, number>;
  byMode: Record<string, number>;
} {
  const byCategory: Record<string, number> = {};
  const byMode: Record<string, number> = {};
  let executable = 0;
  let disabled = 0;

  for (const cap of capMap.values()) {
    byCategory[cap.category] = (byCategory[cap.category] ?? 0) + 1;
    byMode[cap.currentEffectiveMode] = (byMode[cap.currentEffectiveMode] ?? 0) + 1;
    if (cap.isExecutable) executable++;
    else disabled++;
  }

  return { total: capMap.size, executable, disabled, byCategory, byMode };
}
