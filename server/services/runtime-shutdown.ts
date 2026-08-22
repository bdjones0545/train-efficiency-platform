const DEFAULT_GRACE_MS = 10_000;

let shuttingDown = false;
let shutdownPromise: Promise<ShutdownResult> | null = null;
const stopHooks = new Map<string, () => void | Promise<void>>();
const activeTasks = new Map<Promise<unknown>, string>();

export interface ShutdownResult { timedOut: boolean; remainingTasks: number }

export function isShuttingDown(): boolean { return shuttingDown; }
export function getActiveBackgroundTaskCount(): number { return activeTasks.size; }

export function registerShutdownStop(name: string, stop: () => void | Promise<void>): () => void {
  stopHooks.set(name, stop);
  return () => { if (stopHooks.get(name) === stop) stopHooks.delete(name); };
}

export function trackBackgroundTask<T>(label: string, work: () => Promise<T>): Promise<T | undefined> {
  if (shuttingDown) return Promise.resolve(undefined);
  let tracked!: Promise<T>;
  tracked = Promise.resolve().then(work).finally(() => activeTasks.delete(tracked));
  activeTasks.set(tracked, label);
  return tracked;
}

async function waitForDrain(graceMs: number): Promise<boolean> {
  const deadline = Date.now() + graceMs;
  while (activeTasks.size > 0) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await Promise.race([
      Promise.allSettled([...activeTasks.keys()]),
      new Promise(resolve => setTimeout(resolve, remaining)),
    ]);
  }
  return true;
}

export function shutdownRuntime(options: {
  reason: string;
  graceMs?: number;
  stopAccepting?: () => void | Promise<void>;
  closeResources?: () => void | Promise<void>;
}): Promise<ShutdownResult> {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  shutdownPromise = (async () => {
    const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
    console.log(`[Shutdown] initiated reason=${options.reason} active=${activeTasks.size}`);
    let acceptingStopped: Promise<void>;
    try { acceptingStopped = Promise.resolve(options.stopAccepting?.()).then(() => undefined); }
    catch (error) {
      console.error("[Shutdown] failed to stop accepting work:", error);
      acceptingStopped = Promise.resolve();
    }
    acceptingStopped.catch(error => console.error("[Shutdown] failed to stop accepting work:", error));
    await Promise.allSettled([...stopHooks].map(async ([name, stop]) => {
      try { await stop(); }
      catch (error) { console.error(`[Shutdown] stop hook failed name=${name}:`, error); }
    }));
    console.log(`[Shutdown] new background work stopped active=${activeTasks.size}`);
    const drained = await waitForDrain(graceMs);
    if (drained) console.log("[Shutdown] in-flight drain completed");
    else console.warn(`[Shutdown] in-flight drain timed out active=${activeTasks.size}`);
    await Promise.resolve().then(options.closeResources).catch(error =>
      console.error("[Shutdown] resource close failed:", error));
    void acceptingStopped;
    console.log(`[Shutdown] complete timedOut=${!drained} active=${activeTasks.size}`);
    return { timedOut: !drained, remainingTasks: activeTasks.size };
  })();
  return shutdownPromise;
}

export function resetRuntimeShutdownForTests(): void {
  shuttingDown = false;
  shutdownPromise = null;
  stopHooks.clear();
  activeTasks.clear();
}
