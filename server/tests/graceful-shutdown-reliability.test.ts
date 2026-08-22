import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { readFile } from "node:fs/promises";
import {
  getActiveBackgroundTaskCount,
  isShuttingDown,
  registerShutdownStop,
  resetRuntimeShutdownForTests,
  shutdownRuntime,
  trackBackgroundTask,
} from "../services/runtime-shutdown";

const deferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

beforeEach(() => resetRuntimeShutdownForTests());

test("zero-active-work shutdown stops and closes immediately", async () => {
  const events: string[] = [];
  registerShutdownStop("worker", () => { events.push("stop"); });
  const result = await shutdownRuntime({ reason: "test", graceMs: 50,
    stopAccepting: () => { events.push("http"); }, closeResources: () => { events.push("db"); } });
  assert.deepEqual(result, { timedOut: false, remainingTasks: 0 });
  assert.deepEqual(events, ["http", "stop", "db"]);
});

test("shutdown state prevents new tracked background work", async () => {
  let calls = 0;
  await shutdownRuntime({ reason: "test" });
  await trackBackgroundTask("late", async () => { calls++; });
  assert.equal(calls, 0);
  assert.equal(isShuttingDown(), true);
});

test("active workflow-like task completes before database close", async () => {
  const gate = deferred(); const events: string[] = [];
  const task = trackBackgroundTask("workflow-job:1", async () => { await gate.promise; events.push("effect-complete"); });
  const shutdown = shutdownRuntime({ reason: "SIGTERM", graceMs: 100,
    closeResources: () => { events.push("db-close"); } });
  gate.resolve();
  assert.equal((await shutdown).timedOut, false);
  await task;
  assert.deepEqual(events, ["effect-complete", "db-close"]);
});

test("three active worker tasks drain to zero", async () => {
  const gates = [deferred(), deferred(), deferred()];
  const tasks = gates.map((gate, index) => trackBackgroundTask(`worker:${index}`, () => gate.promise));
  const shutdown = shutdownRuntime({ reason: "SIGTERM", graceMs: 100 });
  gates.forEach(gate => gate.resolve());
  await Promise.all(tasks);
  assert.deepEqual(await shutdown, { timedOut: false, remainingTasks: 0 });
});

test("forced grace timeout closes resources and leaves task unsettled", async () => {
  const gate = deferred(); let closed = false;
  void trackBackgroundTask("workflow-job:hanging", () => gate.promise);
  const result = await shutdownRuntime({ reason: "SIGTERM", graceMs: 5, closeResources: () => { closed = true; } });
  assert.equal(result.timedOut, true);
  assert.equal(result.remainingTasks, 1);
  assert.equal(closed, true);
  gate.resolve();
});

test("double signal shares one shutdown and closes resources once", async () => {
  let closes = 0;
  const first = shutdownRuntime({ reason: "SIGTERM", closeResources: () => { closes++; } });
  const second = shutdownRuntime({ reason: "SIGINT", closeResources: () => { closes++; } });
  assert.equal(first, second);
  await Promise.all([first, second]);
  assert.equal(closes, 1);
});

test("task error unregisters and cannot hang drain", async () => {
  const gate = deferred();
  const task = trackBackgroundTask("failing", async () => { await gate.promise; throw new Error("mock failure"); });
  task.catch(() => undefined);
  const shutdown = shutdownRuntime({ reason: "SIGTERM", graceMs: 100 });
  gate.resolve();
  assert.equal((await shutdown).timedOut, false);
  assert.equal(getActiveBackgroundTaskCount(), 0);
});

test("all registered worker stop hooks run", async () => {
  const stopped = new Set<string>();
  registerShutdownStop("workflow", () => { stopped.add("workflow"); });
  registerShutdownStop("dead-letter", () => { stopped.add("dead-letter"); });
  registerShutdownStop("follow-up", () => { stopped.add("follow-up"); });
  await shutdownRuntime({ reason: "SIGTERM" });
  assert.deepEqual([...stopped].sort(), ["dead-letter", "follow-up", "workflow"]);
});

test("stop-hook failure does not prevent drain or resource close", async () => {
  let closed = false;
  registerShutdownStop("broken", () => { throw new Error("stop failed"); });
  const result = await shutdownRuntime({ reason: "SIGTERM", closeResources: () => { closed = true; } });
  assert.equal(result.timedOut, false);
  assert.equal(closed, true);
});

test("already queued callback cannot begin after shutdown state is set", async () => {
  let claimed = false;
  const queuedCallback = () => trackBackgroundTask("queued-poll", async () => { claimed = true; });
  await shutdownRuntime({ reason: "SIGTERM" });
  await queuedCallback();
  assert.equal(claimed, false);
});

test("HTTP stop begins before an active background drain finishes", async () => {
  const gate = deferred(); const events: string[] = [];
  void trackBackgroundTask("scheduler:active", async () => { await gate.promise; events.push("work"); });
  const shutdown = shutdownRuntime({ reason: "SIGTERM", graceMs: 100,
    stopAccepting: () => { events.push("http"); }, closeResources: () => { events.push("db"); } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ["http"]);
  gate.resolve(); await shutdown;
  assert.deepEqual(events, ["http", "work", "db"]);
});

test("resource close occurs only after every completed task unregisters", async () => {
  const gates = [deferred(), deferred()]; let activeAtClose = -1;
  gates.forEach((gate, index) => { void trackBackgroundTask(`task:${index}`, () => gate.promise); });
  const shutdown = shutdownRuntime({ reason: "SIGTERM", graceMs: 100,
    closeResources: () => { activeAtClose = getActiveBackgroundTaskCount(); } });
  gates.forEach(gate => gate.resolve()); await shutdown;
  assert.equal(activeAtClose, 0);
});

test("scheduler wrapper checks shutdown before lock acquisition and tracks work", async () => {
  const source = await readFile(new URL("../services/ceo-heartbeat-service.ts", import.meta.url), "utf8");
  assert.match(source, /export async function acquireJobLock[\s\S]*?if \(isShuttingDown\(\)\)/);
  assert.match(source, /trackBackgroundTask\(`scheduler-lock:/);
  assert.match(source, /if \(isShuttingDown\(\)\) return \{ executed: false, reason: "shutdown" \}/);
  assert.match(source, /trackBackgroundTask\(`scheduler:/);
  assert.match(source, /finally \{\s*stopHeartbeat\(\);\s*await releaseJobLock/s);
});

test("durable worker callbacks check shutdown after timer queueing", async () => {
  const workflow = await readFile(new URL("../workflow-job-runner.ts", import.meta.url), "utf8");
  const deadLetter = await readFile(new URL("../services/agent-dead-letter-service.ts", import.meta.url), "utf8");
  const followUp = await readFile(new URL("../email-agent/follow-up-cron.ts", import.meta.url), "utf8");
  assert.match(workflow, /shutdownRequested \|\| isShuttingDown\(\)/);
  assert.match(deadLetter, /workerStopping \|\| isShuttingDown\(\)/);
  assert.match(followUp, /if \(isShuttingDown\(\)\) return/);
});
