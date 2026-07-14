/**
 * Kevin Slack Executive Operations Hub — Feature Flags & Configuration
 *
 * All flags default to false. Secrets are server-only and never surfaced
 * to client code, API responses, or audit logs.
 *
 * Flag dependency map:
 *
 * Any Slack behavior requires:
 *   KEVIN_SLACK_ENABLED
 *
 * Events require:
 *   KEVIN_SLACK_ENABLED + KEVIN_SLACK_EVENTS_ENABLED
 *
 * Slash commands require:
 *   KEVIN_SLACK_ENABLED + KEVIN_SLACK_COMMANDS_ENABLED
 *
 * Interactive actions require:
 *   KEVIN_SLACK_ENABLED + KEVIN_SLACK_ACTIONS_ENABLED
 *
 * Scheduling write actions require:
 *   KEVIN_SLACK_ENABLED + KEVIN_SLACK_EVENTS_ENABLED +
 *   KEVIN_SLACK_COMMANDS_ENABLED + KEVIN_SLACK_ACTIONS_ENABLED +
 *   KEVIN_SLACK_SCHEDULING_ENABLED
 *
 * Approvals require:
 *   KEVIN_SLACK_ENABLED + KEVIN_SLACK_ACTIONS_ENABLED +
 *   KEVIN_SLACK_APPROVALS_ENABLED
 *
 * Notifications require:
 *   KEVIN_SLACK_ENABLED + KEVIN_SLACK_NOTIFICATIONS_ENABLED
 *
 * Digests require:
 *   KEVIN_SLACK_ENABLED + KEVIN_SLACK_DIGESTS_ENABLED
 *
 * Obsidian memory requires:
 *   KEVIN_SLACK_ENABLED + KEVIN_SLACK_OBSIDIAN_MEMORY_ENABLED
 */

export interface KevinSlackConfig {
  enabled: boolean;
  eventsEnabled: boolean;
  commandsEnabled: boolean;
  actionsEnabled: boolean;
  notificationsEnabled: boolean;
  digestsEnabled: boolean;
  schedulingEnabled: boolean;
  approvalsEnabled: boolean;
  obsidianMemoryEnabled: boolean;
  appId: string | null;
}

function envBool(key: string): boolean {
  const val = process.env[key];
  return val === "true" || val === "1";
}

function envStr(key: string): string | null {
  return process.env[key] ?? null;
}

export function getKevinSlackConfig(): KevinSlackConfig {
  return {
    enabled: envBool("KEVIN_SLACK_ENABLED"),
    eventsEnabled: envBool("KEVIN_SLACK_EVENTS_ENABLED"),
    commandsEnabled: envBool("KEVIN_SLACK_COMMANDS_ENABLED"),
    actionsEnabled: envBool("KEVIN_SLACK_ACTIONS_ENABLED"),
    notificationsEnabled: envBool("KEVIN_SLACK_NOTIFICATIONS_ENABLED"),
    digestsEnabled: envBool("KEVIN_SLACK_DIGESTS_ENABLED"),
    schedulingEnabled: envBool("KEVIN_SLACK_SCHEDULING_ENABLED"),
    approvalsEnabled: envBool("KEVIN_SLACK_APPROVALS_ENABLED"),
    obsidianMemoryEnabled: envBool("KEVIN_SLACK_OBSIDIAN_MEMORY_ENABLED"),
    appId: envStr("SLACK_APP_ID"),
  };
}

export function isSlackEnabled(): boolean {
  return envBool("KEVIN_SLACK_ENABLED");
}

export function isEventsEnabled(): boolean {
  return envBool("KEVIN_SLACK_ENABLED") && envBool("KEVIN_SLACK_EVENTS_ENABLED");
}

export function isCommandsEnabled(): boolean {
  return envBool("KEVIN_SLACK_ENABLED") && envBool("KEVIN_SLACK_COMMANDS_ENABLED");
}

export function isActionsEnabled(): boolean {
  return envBool("KEVIN_SLACK_ENABLED") && envBool("KEVIN_SLACK_ACTIONS_ENABLED");
}

export function isNotificationsEnabled(): boolean {
  return envBool("KEVIN_SLACK_ENABLED") && envBool("KEVIN_SLACK_NOTIFICATIONS_ENABLED");
}

export function isDigestsEnabled(): boolean {
  return envBool("KEVIN_SLACK_ENABLED") && envBool("KEVIN_SLACK_DIGESTS_ENABLED");
}

export function isSchedulingEnabled(): boolean {
  return (
    envBool("KEVIN_SLACK_ENABLED") &&
    envBool("KEVIN_SLACK_EVENTS_ENABLED") &&
    envBool("KEVIN_SLACK_COMMANDS_ENABLED") &&
    envBool("KEVIN_SLACK_ACTIONS_ENABLED") &&
    envBool("KEVIN_SLACK_SCHEDULING_ENABLED")
  );
}

export function isApprovalsEnabled(): boolean {
  return (
    envBool("KEVIN_SLACK_ENABLED") &&
    envBool("KEVIN_SLACK_ACTIONS_ENABLED") &&
    envBool("KEVIN_SLACK_APPROVALS_ENABLED")
  );
}

export function isObsidianMemoryEnabled(): boolean {
  return envBool("KEVIN_SLACK_ENABLED") && envBool("KEVIN_SLACK_OBSIDIAN_MEMORY_ENABLED");
}

/** Returns bot token — NEVER log or expose to client */
export function getSlackBotToken(): string | null {
  return process.env.SLACK_BOT_TOKEN ?? null;
}

/** Returns signing secret — NEVER log or expose to client */
export function getSlackSigningSecret(): string | null {
  return process.env.SLACK_SIGNING_SECRET ?? null;
}

export function getSlackClientId(): string | null {
  return process.env.SLACK_CLIENT_ID ?? null;
}
