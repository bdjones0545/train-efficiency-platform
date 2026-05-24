// ─── Contextual Navigation Helper ────────────────────────────────────────────
// Standardises cross-tool navigation so athlete/team/org context is never lost
// when a coach moves from one tool to another (e.g. Athlete Status → Comms).

export type ContextNavOptions = {
  route: string;          // Relative route e.g. "/coach/communications-center"
  orgSlug: string;
  athleteId?: string;
  teamId?: string;
  messageType?: string;   // Pre-fill the message type in Comms Center
  source?: string;        // Originating tool e.g. "athlete-status", "command-center"
  interventionId?: string;
  returnPath?: string;    // Where to go when the user clicks "Back"
};

/** Build a fully-qualified org URL with context encoded as search params. */
export function buildContextUrl(opts: ContextNavOptions): string {
  const base = `/org/${opts.orgSlug}${opts.route}`;
  const params = new URLSearchParams();
  if (opts.athleteId) params.set("athleteId", opts.athleteId);
  if (opts.teamId) params.set("teamId", opts.teamId);
  if (opts.messageType) params.set("messageType", opts.messageType);
  if (opts.source) params.set("source", opts.source);
  if (opts.interventionId) params.set("interventionId", opts.interventionId);
  if (opts.returnPath) params.set("returnPath", opts.returnPath);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * Navigate to a tool while preserving athlete/team/org context.
 * Pass Wouter's `setLocation` as the first argument.
 *
 * @example
 * navigateWithContext(setLocation, {
 *   route: "/coach/communications-center",
 *   orgSlug: slug,
 *   athleteId: userId,
 *   source: "athlete-status",
 *   messageType: "low_readiness",
 * });
 */
export function navigateWithContext(
  setLocation: (to: string) => void,
  opts: ContextNavOptions,
): void {
  setLocation(buildContextUrl(opts));
}
