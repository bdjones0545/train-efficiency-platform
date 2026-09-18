/**
 * Automation sends kill-switch — single source of truth.
 * ─────────────────────────────────────────────────────────────────────────────
 * The README describes AUTOMATION_SENDS_ENABLED as "a global emergency
 * off-switch for automated outreach". Until this module existed the flag was
 * read in exactly one place (server/services/guarded-outbound-email.ts), so the
 * automated senders that never route through that chain — the lead-capture
 * nurture cron, the weekly "we miss you" re-engagement sweep and the attendance
 * report cron — kept sending with the switch off.
 *
 * Every automated sender now consults THIS helper, with the same semantics the
 * guarded chain has always had:
 *
 *   AUTOMATION_SENDS_ENABLED="false" | "0"  → disabled
 *   unset, or any other value               → enabled (current behavior)
 *
 * Transactional mail (booking confirmations, session reminders, password
 * resets, receipts, the immediate confirmation to the org admin when a lead
 * submits) is intentionally NOT gated: those are replies to a human action, not
 * automation, and an emergency stop on outreach must not break them.
 */

export const AUTOMATION_SENDS_ENV_VAR = "AUTOMATION_SENDS_ENABLED";

/** The exact reason string the guarded chain has always reported. */
export const AUTOMATION_KILL_SWITCH_REASON =
  "global kill-switch (AUTOMATION_SENDS_ENABLED=false)";

/**
 * True when automated sends are permitted. Disabled ONLY when the env var is
 * exactly "false" or "0" — unset or any other value keeps the current behavior.
 */
export function isAutomationSendsEnabled(): boolean {
  const v = process.env[AUTOMATION_SENDS_ENV_VAR];
  return !(v === "false" || v === "0");
}

/** Convenience inverse — reads better at the top of a cron run. */
export function automationSendsDisabled(): boolean {
  return !isAutomationSendsEnabled();
}

// ── Log-once-per-run bookkeeping ──────────────────────────────────────────────
// A sweep that skips 400 rows should say so once, not 400 times.

const loggedScopes = new Set<string>();

/**
 * Logs "skipped, kill-switch is on" once per scope per run. Call
 * `resetAutomationSendsLog()` at the start of a run (the cron wrappers do) so
 * the next run logs again.
 */
export function logAutomationSendsDisabled(scope: string): void {
  if (loggedScopes.has(scope)) return;
  loggedScopes.add(scope);
  console.warn(
    `[AutomationSends] ${scope} skipped — ${AUTOMATION_KILL_SWITCH_REASON}`,
  );
}

/** Clears the log-once memory so the next run reports again. */
export function resetAutomationSendsLog(scope?: string): void {
  if (scope) loggedScopes.delete(scope);
  else loggedScopes.clear();
}

/**
 * Guard for the top of an automated run: returns true when the run should stop.
 * Logs once per scope.
 */
export function automationRunBlocked(scope: string): boolean {
  if (isAutomationSendsEnabled()) return false;
  logAutomationSendsDisabled(scope);
  return true;
}

/**
 * The sequence_status a newly captured lead is enrolled with. When the
 * kill-switch is on the lead is still saved in full — only the automated
 * nurture sequence is withheld, in a state the cron sweep does not select.
 */
export const SEQUENCE_STATUS_AUTOMATION_DISABLED = "automation_disabled";

export function initialSequenceStatus(): string {
  return isAutomationSendsEnabled() ? "pending" : SEQUENCE_STATUS_AUTOMATION_DISABLED;
}
