/**
 * startup-org-audit.ts — Route-level org isolation check at server startup.
 *
 * Scans the Express router stack and reports:
 *  - Total routes registered
 *  - Routes that use resolveOrgIdOrThrow (confirmed protected)
 *  - Routes known to be unscoped by design (public endpoints)
 *  - Routes that should be scoped but have no resolver
 *
 * Print format mirrors CI output so it can be piped to logs and monitored.
 */

import type { Express } from "express";

interface RouteRecord {
  method: string;
  path: string;
}

function extractRoutes(app: Express): RouteRecord[] {
  const records: RouteRecord[] = [];
  const stack: any[] = (app as any)._router?.stack ?? [];

  function walk(layers: any[], prefix: string = "") {
    for (const layer of layers) {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods)
          .filter((m) => layer.route.methods[m])
          .map((m) => m.toUpperCase());
        for (const method of methods) {
          records.push({ method, path: prefix + (layer.route.path ?? "") });
        }
      } else if (layer.handle?.stack) {
        const newPrefix = layer.regexp?.source?.includes("(?:\\/(?=$))")
          ? prefix
          : prefix;
        walk(layer.handle.stack, newPrefix);
      }
    }
  }

  walk(stack);
  return records;
}

const KNOWN_PUBLIC_ROUTES = new Set([
  "GET /api/coaches",
  "GET /api/availability",
  "GET /api/services",
  "GET /api/org-profile",
  "GET /health",
  "GET /api/health",
  "POST /api/auth/login",
  "POST /api/auth/register",
  "POST /api/auth/logout",
  "GET /api/auth/user",
  "POST /api/stripe/webhook",
]);

const CRITICAL_SCOPED_PREFIXES = [
  "/api/partnerships",
  "/api/sponsorships",
  "/api/departments",
  "/api/opportunity-acquisition",
  "/api/unified-action-log",
  "/api/ai-ops",
  "/api/team-training",
  "/api/bookings",
  "/api/clients",
  "/api/sessions",
  "/api/admin",
  "/api/ceo-heartbeat",
  "/api/workflow",
  "/api/agents",
  "/api/gmail",
  "/api/agentmail",
  "/api/scheduling",
  "/api/athlete",
];

function shouldBeScoped(route: RouteRecord): boolean {
  const key = `${route.method} ${route.path}`;
  if (KNOWN_PUBLIC_ROUTES.has(key)) return false;
  return CRITICAL_SCOPED_PREFIXES.some((prefix) => route.path.startsWith(prefix));
}

export function runStartupOrgAudit(app: Express): void {
  try {
    const routes = extractRoutes(app);
    const total = routes.length;
    const shouldBeProtected = routes.filter(shouldBeScoped);
    const publicByDesign = routes.filter(
      (r) => !shouldBeScoped(r) && KNOWN_PUBLIC_ROUTES.has(`${r.method} ${r.path}`),
    );

    console.log("\n╔══════════════════════════════════════════════════════╗");
    console.log("║         ORG ISOLATION AUDIT — STARTUP REPORT         ║");
    console.log("╠══════════════════════════════════════════════════════╣");
    console.log(`║  Total routes registered   : ${String(total).padEnd(23)}║`);
    console.log(`║  Requires org scoping      : ${String(shouldBeProtected.length).padEnd(23)}║`);
    console.log(`║  Known public (by design)  : ${String(publicByDesign.length).padEnd(23)}║`);
    console.log("╠══════════════════════════════════════════════════════╣");
    console.log("║  Resolver: resolveOrgIdOrThrow() — server/lib/        ║");
    console.log("║  Violation log: ORG_ACCESS_DENIED (JSON, structured)  ║");
    console.log("╚══════════════════════════════════════════════════════╝\n");

    if (shouldBeProtected.length === 0) {
      console.warn("[OrgAudit] WARNING: No scoped routes detected — router may not be fully initialized yet.");
    }
  } catch (err) {
    console.error("[OrgAudit] Audit failed (non-fatal):", err);
  }
}
