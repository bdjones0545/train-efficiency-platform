import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...parts: string[]) => readFileSync(path.join(repoRoot, ...parts), "utf8");

/**
 * package-lock.json once pinned 124 of its 952 resolved URLs to
 * http://package-firewall.replit.local, Replit's internal package proxy. That
 * host resolves nowhere else, so a clean install anywhere but Replit either
 * failed outright (npm 11) or — worse — reported success with packages missing
 * (npm 10), which surfaced as 45 phantom "Cannot find module 'openai'" errors
 * from the server typecheck gate.
 *
 * Regenerating the lockfile from a Replit shell will reintroduce those URLs.
 * This is here so that happens loudly, in a pull request, rather than as a
 * mysterious CI failure weeks later.
 */

const ALLOWED_REGISTRY_HOSTS = new Set(["registry.npmjs.org"]);

function resolvedHosts(lockfile: string): Map<string, number> {
  const hosts = new Map<string, number>();
  for (const match of lockfile.matchAll(/"resolved":\s*"([a-z]+):\/\/([^/"]+)/g)) {
    const host = match[2];
    hosts.set(host, (hosts.get(host) ?? 0) + 1);
  }
  return hosts;
}

test("every resolved URL points at a public registry", () => {
  const hosts = resolvedHosts(read("package-lock.json"));
  assert.ok(hosts.size > 0, "expected the lockfile to carry resolved URLs");

  const foreign = [...hosts.entries()].filter(([host]) => !ALLOWED_REGISTRY_HOSTS.has(host));
  assert.deepEqual(
    foreign,
    [],
    "the lockfile pins a host that only resolves inside one environment — " +
      "a clean install elsewhere will fail or, worse, silently omit packages:\n  " +
      foreign.map(([h, n]) => `${h} (${n} entries)`).join("\n  "),
  );
});

test("resolved URLs are fetched over https", () => {
  const insecure = [...read("package-lock.json").matchAll(/"resolved":\s*"http:\/\/([^/"]+)/g)];
  assert.deepEqual(
    insecure.map((m) => m[1]),
    [],
    "package tarballs must not be fetched over plaintext http",
  );
});

test("no npm configuration redirects installs to a private registry", () => {
  // A committed .npmrc would reintroduce the same problem by another route.
  let npmrc: string | null = null;
  try {
    npmrc = read(".npmrc");
  } catch {
    return; // absent is the expected state
  }
  assert.doesNotMatch(npmrc, /registry\s*=/, ".npmrc must not pin a registry");
});
