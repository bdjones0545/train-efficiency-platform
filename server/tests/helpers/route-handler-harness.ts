/**
 * Executes a single route handler lifted verbatim out of server/routes.ts.
 *
 * registerRoutes() cannot be called in a unit test: it needs a database and
 * an OIDC issuer at registration time. Instead, the `app.<method>("<path>",
 * ...)` statement is cut out of the source, transpiled, and evaluated with
 * every free identifier (storage, db, org resolvers, mailers, ...) resolved
 * through a `provided` scope. The handler that runs is the real one — the
 * test decides only what its collaborators answer.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export type Handler = (req: any, res: any, next: () => Promise<void>) => unknown;
export type Route = { method: string; path: string; handlers: Handler[] };

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const routesSource = readFileSync(path.join(serverDir, "routes.ts"), "utf8");

/** The `app.<method>("<path>", ...)` statement, up to its own `  });` line. */
export function routeBlock(method: string, routePath: string): string {
  const lines = routesSource.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`  app.${method}("${routePath}",`));
  assert.ok(start >= 0, `${method.toUpperCase()} ${routePath} not found in routes.ts`);
  const end = lines.findIndex((line, i) => i > start && line === "  });");
  assert.ok(end > start, `${method.toUpperCase()} ${routePath} has no closing "  });"`);
  return lines.slice(start, end + 1).join("\n");
}

/**
 * Runs the route statement with every free identifier resolved through
 * `provided` (falling back to real globals) and returns the registered route.
 * Lazy `import("./x")` calls resolve to a module whose every export is an
 * async no-op, so fire-and-forget side effects neither run nor hang.
 */
export function loadRoute(method: string, routePath: string, provided: Record<string, unknown>): Route {
  const { outputText } = ts.transpileModule(routeBlock(method, routePath), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  const js = outputText.replace(/\bimport\(/g, "__dynamicImport(");
  const routes: Route[] = [];
  const app = new Proxy({}, {
    get: (_t, m: string) => (p: string, ...handlers: Handler[]) => { routes.push({ method: m, path: p, handlers }); },
  });
  // `then` must stay undefined or `await import(...)` would treat the module as a thenable.
  const dynamicModule = new Proxy({}, { get: (_t, key) => (key === "then" || typeof key !== "string" ? undefined : async () => undefined) });
  const scope = new Proxy({ ...provided, app, __dynamicImport: async () => dynamicModule }, {
    has(target, key) {
      if (typeof key !== "string") return false;
      return key in target || !(key in globalThis);
    },
    get(target: any, key) {
      if (typeof key !== "string") return undefined;
      if (key in target) return target[key];
      return () => { throw new Error(`route harness: "${key}" is not stubbed`); };
    },
  });
  // eslint-disable-next-line no-new-func
  new Function("__scope", `with (__scope) { ${js} }`)(scope);
  assert.equal(routes.length, 1, `expected exactly one route in the ${method.toUpperCase()} ${routePath} block`);
  return routes[0];
}

export function recorder() {
  return {
    statusCode: 200,
    payload: undefined as any,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.payload = payload; return this; },
    send(payload: unknown) { this.payload = payload; return this; },
    end() { return this; },
  };
}

/** Runs middleware and handler in order, exactly as Express would. */
export async function dispatch(route: Route, req: any) {
  const res = recorder();
  let i = 0;
  const next = async () => { const h = route.handlers[i++]; if (h) await h(req, res, next); };
  await next();
  return res;
}

/** Stand-in for the OIDC/Bearer middleware: authenticated iff req.user is set. */
export const isAuthenticated: Handler = async (req, res, next) =>
  req.user ? next() : res.status(401).json({ message: "Unauthorized" });

export function asUser(userId: string, extra: Record<string, unknown> = {}) {
  return { headers: {}, user: { claims: { sub: userId }, expires_at: Number.MAX_SAFE_INTEGER }, params: {}, body: {}, query: {}, ...extra };
}

/** Shadows methods on the storage singleton; returns the restore function. */
export function stubStorage(storage: object, overrides: Record<string, unknown>) {
  const target = storage as any;
  for (const [k, v] of Object.entries(overrides)) target[k] = v;
  return () => { for (const k of Object.keys(overrides)) delete target[k]; };
}
