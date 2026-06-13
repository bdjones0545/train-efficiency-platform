import { acquireJobLock, releaseJobLock, writeTimeline } from "./ceo-heartbeat-service";

// ─── Types ─────────────────────────────────────────────────────────────────

export type GmailSyncStatus = "idle" | "running" | "success" | "failed" | "skipped";

interface OrgSyncState {
  lastSyncAt: Date | null;
  nextSyncAt: Date | null;
  status: GmailSyncStatus;
  errorMessage: string | null;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const GMAIL_SYNC_INTERVAL_MS = 60 * 60 * 1000; // 60 minutes
const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 60 minutes

// ─── In-memory state (per org) ───────────────────────────────────────────────

const _orgStates = new Map<string, OrgSyncState>();
let _cronInterval: ReturnType<typeof setInterval> | null = null;

function getOrInitState(orgId: string): OrgSyncState {
  if (!_orgStates.has(orgId)) {
    _orgStates.set(orgId, {
      lastSyncAt: null,
      nextSyncAt: new Date(Date.now() + GMAIL_SYNC_INTERVAL_MS),
      status: "idle",
      errorMessage: null,
    });
  }
  return _orgStates.get(orgId)!;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function getGmailSyncStatus(orgId: string): {
  lastGmailSyncAt: string | null;
  nextGmailSyncAt: string | null;
  lastGmailSyncStatus: GmailSyncStatus;
  lastGmailSyncError: string | null;
} {
  const state = getOrInitState(orgId);
  return {
    lastGmailSyncAt: state.lastSyncAt?.toISOString() ?? null,
    nextGmailSyncAt: state.nextSyncAt?.toISOString() ?? null,
    lastGmailSyncStatus: state.status,
    lastGmailSyncError: state.errorMessage,
  };
}

export async function runGmailSyncForOrg(
  orgId: string,
  triggeredBy = "cron"
): Promise<{
  success: boolean;
  alreadyRunning: boolean;
  synced?: number;
  classified?: number;
  actionsQueued?: number;
  error?: string;
}> {
  const { acquired, lockKey } = await acquireJobLock(orgId, "gmail_sync", 55);
  if (!acquired) {
    console.log(`[gmail-sync] orgId=${orgId} lock held — skipping (triggered by ${triggeredBy})`);
    return { success: false, alreadyRunning: true };
  }

  const state = getOrInitState(orgId);
  state.status = "running";
  state.errorMessage = null;

  try {
    const { runLeadReplyRecovery } = await import("./gmail-agent-service");
    const result = await runLeadReplyRecovery(orgId);

    state.lastSyncAt = new Date();
    state.nextSyncAt = new Date(Date.now() + GMAIL_SYNC_INTERVAL_MS);
    state.status = "success";
    state.errorMessage = null;

    console.log(`[gmail-sync] orgId=${orgId} triggeredBy=${triggeredBy} success:`, result);
    return { success: true, alreadyRunning: false, ...(result as any) };
  } catch (err: any) {
    state.lastSyncAt = new Date();
    state.nextSyncAt = new Date(Date.now() + GMAIL_SYNC_INTERVAL_MS);
    state.status = "failed";
    state.errorMessage = err.message ?? "Unknown error";
    console.error(`[gmail-sync] orgId=${orgId} triggeredBy=${triggeredBy} error:`, err.message);
    return { success: false, alreadyRunning: false, error: err.message };
  } finally {
    await releaseJobLock(lockKey);
  }
}

export async function runGmailSyncIfStale(
  orgId: string,
  heartbeatId?: string
): Promise<{
  triggered: boolean;
  skipped: boolean;
  reason: string;
}> {
  const state = getOrInitState(orgId);
  const isStale =
    !state.lastSyncAt ||
    Date.now() - state.lastSyncAt.getTime() > STALE_THRESHOLD_MS;

  if (!isStale) {
    const minsAgo = Math.floor((Date.now() - state.lastSyncAt!.getTime()) / 60000);
    const reason = `Last sync was ${minsAgo}m ago — within 60m window`;

    await writeTimeline({
      orgId,
      heartbeatId,
      agentName: "gmail_sync_agent",
      systemName: "CEO Heartbeat",
      actionType: "gmail_sync_check",
      actionStatus: "skipped",
      summary: `Gmail Sync: skipped — ${reason}`,
    }).catch(() => {});

    return { triggered: false, skipped: true, reason };
  }

  const result = await runGmailSyncForOrg(orgId, "heartbeat");

  if (result.alreadyRunning) {
    const reason = "Sync already in progress";
    await writeTimeline({
      orgId,
      heartbeatId,
      agentName: "gmail_sync_agent",
      systemName: "CEO Heartbeat",
      actionType: "gmail_sync_check",
      actionStatus: "skipped",
      summary: `Gmail Sync: ${reason}`,
    }).catch(() => {});
    return { triggered: false, skipped: true, reason };
  }

  const reason = result.success
    ? `Sync completed — ${result.synced ?? 0} synced, ${result.classified ?? 0} classified, ${result.actionsQueued ?? 0} actions queued`
    : `Sync failed: ${result.error}`;

  await writeTimeline({
    orgId,
    heartbeatId,
    agentName: "gmail_sync_agent",
    systemName: "CEO Heartbeat",
    actionType: "gmail_sync_check",
    actionStatus: result.success ? "completed" : "failed",
    summary: `Gmail Sync (heartbeat triggered): ${reason}`,
    errorMessage: result.success ? undefined : result.error,
  }).catch(() => {});

  return { triggered: true, skipped: false, reason };
}

export async function runGmailSyncForAllOrgs(): Promise<void> {
  try {
    const { db } = await import("../db");
    const { organizations } = await import("@shared/schema");
    const orgs = await db.select({ id: organizations.id }).from(organizations).limit(100);
    for (const org of orgs) {
      await runGmailSyncForOrg(org.id, "cron").catch((err: any) => {
        console.error(`[gmail-sync] cron error for org ${org.id}:`, err.message);
      });
    }
  } catch (err: any) {
    console.error("[gmail-sync] cron: failed to load orgs:", err.message);
  }
}

export function startGmailSyncCron(): void {
  if (_cronInterval) return;
  _cronInterval = setInterval(async () => {
    console.log("[gmail-sync] Hourly cron triggered");
    await runGmailSyncForAllOrgs();
  }, GMAIL_SYNC_INTERVAL_MS);
  console.log("[gmail-sync] Hourly cron started — every 60 minutes");
}
