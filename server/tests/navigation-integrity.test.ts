import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("sidebar distinguishes Attention from AI Approvals", () => {
  const sidebar = read("client/src/components/app-sidebar.tsx");

  assert.match(sidebar, /title: "Attention",\s*url: "\/admin\/attention"/);
  assert.match(sidebar, /title: "Approvals",\s*url: "\/admin\/ai-approvals"/);
  assert.doesNotMatch(sidebar, /title: "Approvals",\s*url: "\/admin\/attention"/);
});

test("sidebar attention badges use the aggregate count endpoint", () => {
  const sidebar = read("client/src/components/app-sidebar.tsx");

  assert.match(sidebar, /queryKey: \["\/api\/attention\/count"\]/);
  assert.doesNotMatch(sidebar, /queryKey: \["\/api\/attention"\]/);
  assert.match(
    sidebar,
    /enabled: isCoachOrAdmin/,
  );
});

test("all Attention Inbox cross-links use the canonical route", () => {
  const communication = read("client/src/pages/admin-communication-intelligence.tsx");
  assert.match(communication, /href: "\/admin\/attention"/);
  assert.doesNotMatch(communication, /href: "\/admin\/attention-inbox"/);
});

test("legacy Attention Inbox URL redirects instead of rendering Not Found", () => {
  const app = read("client/src/App.tsx");
  assert.match(
    app,
    /<Route path="\/admin\/attention-inbox" component=\{RedirectToAttention\} \/>/,
  );
});

test("attention actions use valid lead routes and normalize legacy records", () => {
  const engine = read("server/attention-engine.ts");
  const page = read("client/src/pages/attention-inbox.tsx");
  const routes = read("client/src/lib/attention-routes.ts");

  assert.doesNotMatch(engine, /actionUrl: "\/admin\/leads"/);
  assert.doesNotMatch(page, /path: "\/admin\/leads"/);
  assert.match(engine, /actionUrl: "\/admin\/athlete-leads"/);
  assert.match(routes, /"\/admin\/leads": "\/admin\/athlete-leads"/);
  assert.match(page, /resolveAttentionActionRoute\(item\.actionUrl\)/);
});

test("unknown attention action routes are not rendered as clickable links", () => {
  const routes = read("client/src/lib/attention-routes.ts");
  const page = read("client/src/pages/attention-inbox.tsx");

  assert.match(routes, /return LEGACY_ATTENTION_ROUTE_MAP\[url\] \?\? null/);
  assert.match(page, /\{actionRoute && \(/);
});
