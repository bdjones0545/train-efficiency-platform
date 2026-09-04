/**
 * Finds Express route registrations that declare no middleware at all.
 *
 * Why this is not a grep. An earlier attempt to enumerate unguarded routes by
 * pattern-matching guard names produced false positive after false positive,
 * because this codebase registers routes behind more than twenty different
 * middleware names — isAuthenticated, requireRole, requireCoach, requireOrgAuth,
 * privilegedOnly, requireCoachOrAdmin, acceptOrgOrMainAuth, requireGuardianOrCoach,
 * resolveCoachAuth and more — and some routes authorize inside the handler
 * instead. Any hand-written list of names is out of date the day it is written.
 *
 * So this asks a question that needs no vocabulary: does the registration pass
 * ANY argument between the path and the handler? That is a syntactic property
 * the parser answers exactly.
 *
 * WHAT THIS PROVES: no route is registered with zero middleware unless someone
 * wrote it into the public allowlist on purpose.
 *
 * WHAT IT DOES NOT PROVE: that a declared middleware actually authenticates.
 * A route guarded by a middleware that waves everyone through passes this
 * audit. This finds the gap class "nobody put a guard here at all"; it is not
 * a substitute for reading the guard.
 */

import ts from "typescript";

export const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "all"] as const;

export interface RouteRegistration {
  method: string;
  path: string;
  file: string;
  line: number;
  /** Arguments between the path and the handler. Zero means nothing guards it. */
  guardCount: number;
  /** Best-effort names of those arguments, for the report only. */
  guardNames: string[];
}

function isHandler(node: ts.Expression): boolean {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

function describeArgument(node: ts.Expression): string {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isCallExpression(node)) {
    const target = node.expression;
    return ts.isIdentifier(target) ? `${target.text}()` : "call()";
  }
  if (ts.isSpreadElement(node)) {
    const inner = node.expression;
    return ts.isIdentifier(inner) ? `...${inner.text}` : "...spread";
  }
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isArrayLiteralExpression(node)) return "[middleware]";
  return "expression";
}

/**
 * Extracts every `app.<method>("path", ...)` registration in one source file.
 *
 * `app.get("some-setting")` — Express settings reads — take a single argument
 * and are skipped.
 */
export function findRouteRegistrations(source: string, fileName: string): RouteRegistration[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2020, true);
  const found: RouteRegistration[] = [];

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const target = node.expression.expression;
      const targetName = ts.isIdentifier(target) ? target.text : "";

      if (
        (HTTP_METHODS as readonly string[]).includes(method) &&
        (targetName === "app" || targetName === "router") &&
        node.arguments.length >= 2
      ) {
        const [pathArg, ...rest] = node.arguments;
        if (ts.isStringLiteral(pathArg) || ts.isNoSubstitutionTemplateLiteral(pathArg)) {
          // The handler is the trailing function expression, when there is one.
          const guards = rest.length > 0 && isHandler(rest[rest.length - 1])
            ? rest.slice(0, -1)
            : rest;
          found.push({
            method,
            path: pathArg.text,
            file: fileName,
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
            guardCount: guards.length,
            guardNames: guards.map(describeArgument),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

/** A route in the allowlist, identified the way the audit reports it. */
export interface PublicRouteEntry {
  method: string;
  path: string;
  file: string;
  reason: string;
}

export const routeKey = (r: { method: string; path: string; file: string }) =>
  `${r.method.toUpperCase()} ${r.path} (${r.file})`;

export interface AuditResult {
  /** Registered with no middleware and not declared public. */
  undeclared: RouteRegistration[];
  /** Allowlisted but no longer present in the source. */
  stale: PublicRouteEntry[];
  passed: boolean;
}

export function auditRoutes(
  registrations: RouteRegistration[],
  allowlist: PublicRouteEntry[],
): AuditResult {
  const allowed = new Set(allowlist.map(routeKey));

  // Staleness is measured against the routes that are still UNGUARDED, not
  // against every route. Once a route gains a guard its entry is no longer
  // describing anything, and leaving it in place would silently pre-approve
  // the route going unguarded again later.
  const stillUnguarded = new Set(
    registrations.filter((r) => r.guardCount === 0).map(routeKey),
  );

  const undeclared = registrations
    .filter((r) => r.guardCount === 0 && !allowed.has(routeKey(r)))
    .sort((a, b) => routeKey(a).localeCompare(routeKey(b)));

  const stale = allowlist
    .filter((entry) => !stillUnguarded.has(routeKey(entry)))
    .sort((a, b) => routeKey(a).localeCompare(routeKey(b)));

  return { undeclared, stale, passed: undeclared.length === 0 && stale.length === 0 };
}
