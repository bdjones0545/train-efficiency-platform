import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, test } from "node:test";
import type { Request, Response } from "express";
import { createApiRequestLogger } from "../middleware/api-request-logger";

const SENTINELS = [
  "TOP_SECRET_TOKEN_DO_NOT_LOG",
  "PRIVATE_EMAIL_BODY_DO_NOT_LOG",
  "FINANCIAL_VALUE_DO_NOT_LOG",
  "BEARER_TOKEN_DO_NOT_LOG",
  "SESSION_COOKIE_DO_NOT_LOG",
  "CREDENTIAL_BLOB_DO_NOT_LOG",
];

function runRequest(options: {
  path?: string;
  method?: string;
  statusCode?: number;
  responseBody?: unknown;
  contentLength?: string;
}) {
  const logs: string[] = [];
  let clock = 1_000;
  const req = {
    path: options.path ?? "/api/example",
    method: options.method ?? "GET",
    headers: {
      authorization: `Bearer ${SENTINELS[3]}`,
      cookie: `session=${SENTINELS[4]}`,
    },
  } as unknown as Request;

  const emitter = new EventEmitter();
  let deliveredBody: unknown;
  const originalJson = function (body: unknown) {
    deliveredBody = body;
    return res;
  };
  const headers = new Map<string, string>();
  if (options.contentLength) headers.set("content-length", options.contentLength);
  const res = Object.assign(emitter, {
    statusCode: options.statusCode ?? 200,
    json: originalJson,
    getHeader(name: string) {
      return headers.get(name.toLowerCase());
    },
  }) as unknown as Response;

  let nextCalled = false;
  const middleware = createApiRequestLogger((line) => logs.push(line), () => clock);
  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.json, originalJson, "middleware must not wrap or replace res.json");
  const jsonReturn = res.json(options.responseBody);
  clock = 1_037;
  emitter.emit("finish");

  return { logs, deliveredBody, jsonReturn, res, nextCalled };
}

describe("API request completion logging", () => {
  test("retains safe operational metadata", () => {
    const result = runRequest({ method: "POST", statusCode: 201, contentLength: "42", responseBody: { ok: true } });

    assert.equal(result.nextCalled, true);
    assert.deepEqual(result.logs, [
      "POST /api/example 201 in 37ms classification=success responseBytes=42",
    ]);
  });

  test("never logs response bodies, authentication material, or credential sentinels", () => {
    const responseBody = {
      token: SENTINELS[0],
      privateEmail: SENTINELS[1],
      financialAccount: SENTINELS[2],
      credentials: SENTINELS[5],
    };
    const result = runRequest({ responseBody });
    const output = result.logs.join("\n");

    for (const sentinel of SENTINELS) assert.equal(output.includes(sentinel), false, sentinel);
  });

  test("logs useful error classification without logging the error payload", () => {
    const result = runRequest({
      statusCode: 503,
      responseBody: { error: "provider failed", providerPayload: SENTINELS[0] },
    });

    assert.match(result.logs[0], /GET \/api\/example 503 in 37ms/);
    assert.match(result.logs[0], /classification=server_error/);
    assert.equal(result.logs[0].includes("provider failed"), false);
    assert.equal(result.logs[0].includes(SENTINELS[0]), false);
  });

  test("does not alter JSON response behavior, payload, or status", () => {
    const body = { nested: { value: SENTINELS[1] } };
    const result = runRequest({ statusCode: 422, responseBody: body });

    assert.equal(result.deliveredBody, body);
    assert.equal(result.jsonReturn, result.res);
    assert.equal(result.res.statusCode, 422);
  });

  test("does not log non-API request completions", () => {
    const result = runRequest({ path: "/assets/app.js", responseBody: SENTINELS[0] });
    assert.deepEqual(result.logs, []);
  });
});
