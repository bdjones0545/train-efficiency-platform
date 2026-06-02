/**
 * TrainChat Platform Client (Priority 5 — Safety Pass)
 * ─────────────────────────────────────────────────────────────────────────────
 * Additions vs. original:
 *  - Zod response validation (ProgramResponseSchema, SessionResponseSchema)
 *  - Graceful OpenAI fallback when TrainChat is unreachable
 *  - Platform-key usage logging (fire-and-forget, stored in app_settings)
 *
 * All original functions are preserved unchanged.
 */

import crypto from "crypto";
import { db } from "../db";
import { orgAiIntegrations } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

// ─── Encryption helpers (original, unchanged) ─────────────────────────────────

const ALGORITHM = "aes-256-cbc";

function getEncryptionKey(): Buffer {
  const secret = process.env.INTEGRATION_ENCRYPTION_SECRET;
  if (!secret) throw new Error("INTEGRATION_ENCRYPTION_SECRET is not set");
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptApiKey(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

export function decryptApiKey(encrypted: string): string {
  const key = getEncryptionKey();
  const [ivHex, encHex] = encrypted.split(":");
  if (!ivHex || !encHex) throw new Error("Invalid encrypted key format");
  const iv = Buffer.from(ivHex, "hex");
  const encBuf = Buffer.from(encHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  const decrypted = Buffer.concat([decipher.update(encBuf), decipher.final()]);
  return decrypted.toString("utf8");
}

export function maskApiKey(plaintext: string): string {
  if (plaintext.length <= 8) return plaintext.substring(0, 2) + "••••••••";
  const prefix = plaintext.substring(0, 6);
  return prefix + "••••••••";
}

// ─── Integration lookup (original, unchanged) ─────────────────────────────────

async function getIntegration(orgId: string, provider: string) {
  const [row] = await db
    .select()
    .from(orgAiIntegrations)
    .where(and(eq(orgAiIntegrations.orgId, orgId), eq(orgAiIntegrations.provider, provider)))
    .limit(1);
  return row ?? null;
}

function resolvePlatformKey(): string | undefined {
  return (
    process.env.TRAINCHAT_API_KEY ||
    process.env.TRAINCHAT_EXTERNAL_API_KEY ||
    undefined
  );
}

function resolvePlatformBaseUrl(): string | undefined {
  return (
    process.env.TRAINCHAT_API_BASE_URL ||
    process.env.TRAINCHAT_EXTERNAL_API_BASE_URL ||
    process.env.TRAINCHAT_BASE_URL ||
    undefined
  );
}

async function getDecryptedClient(orgId: string): Promise<{ baseUrl: string; apiKey: string }> {
  const integration = await getIntegration(orgId, "trainchat");
  if (integration?.isActive && integration.apiKeyEncrypted && integration.apiBaseUrl) {
    const apiKey = decryptApiKey(integration.apiKeyEncrypted);
    return { baseUrl: integration.apiBaseUrl.replace(/\/$/, ""), apiKey };
  }
  const envKey = resolvePlatformKey();
  const envBase = resolvePlatformBaseUrl();
  if (envKey && envBase) {
    return { baseUrl: envBase.replace(/\/$/, ""), apiKey: envKey };
  }
  throw new Error(
    "TrainChat is not connected. Configure an org-level integration or set TRAINCHAT_API_KEY + TRAINCHAT_API_BASE_URL."
  );
}

// ─── Connection status (original, unchanged) ──────────────────────────────────

export type TrainChatConnectionStatus = {
  trainChatConnected: boolean;
  connectionMode: "org" | "platform" | "none";
  maskedKeyPreview?: string;
  baseUrl?: string;
  lastError?: string;
};

export async function getConnectionStatus(orgId: string): Promise<TrainChatConnectionStatus> {
  try {
    const integration = await getIntegration(orgId, "trainchat");
    if (integration?.isActive && integration.apiKeyEncrypted && integration.apiBaseUrl) {
      const apiKey = decryptApiKey(integration.apiKeyEncrypted);
      return {
        trainChatConnected: true,
        connectionMode: "org",
        maskedKeyPreview: maskApiKey(apiKey),
        baseUrl: integration.apiBaseUrl.replace(/\/$/, ""),
      };
    }
  } catch {
    // org lookup failed — fall through to platform check
  }

  const envKey = resolvePlatformKey();
  const envBase = resolvePlatformBaseUrl();

  if (envKey && envBase) {
    return {
      trainChatConnected: true,
      connectionMode: "platform",
      maskedKeyPreview: maskApiKey(envKey),
      baseUrl: envBase.replace(/\/$/, ""),
    };
  }
  if (envKey && !envBase) {
    return {
      trainChatConnected: false,
      connectionMode: "none",
      lastError: "TRAINCHAT_API_KEY is set but TRAINCHAT_API_BASE_URL is missing.",
    };
  }
  if (!envKey && envBase) {
    return {
      trainChatConnected: false,
      connectionMode: "none",
      lastError: "TRAINCHAT_API_BASE_URL is set but TRAINCHAT_API_KEY is missing.",
    };
  }
  return {
    trainChatConnected: false,
    connectionMode: "none",
    lastError:
      "No org-level integration configured and no platform secrets found (TRAINCHAT_API_KEY / TRAINCHAT_API_BASE_URL).",
  };
}

// ─── Zod Response Schemas (Priority 5 addition) ───────────────────────────────

const ExerciseSchema = z
  .object({
    name: z.string(),
    sets: z.union([z.number(), z.string()]).optional(),
    reps: z.union([z.number(), z.string()]).optional(),
    duration: z.union([z.number(), z.string()]).optional(),
    rest: z.union([z.number(), z.string()]).optional(),
    notes: z.string().optional(),
  })
  .passthrough();

const WorkoutDaySchema = z
  .object({
    day: z.union([z.string(), z.number()]).optional(),
    name: z.string().optional(),
    exercises: z.array(ExerciseSchema).optional(),
    focus: z.string().optional(),
  })
  .passthrough();

export const ProgramResponseSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    weeks: z.union([z.number(), z.string()]).optional(),
    sessions_per_week: z.union([z.number(), z.string()]).optional(),
    workouts: z.array(WorkoutDaySchema).optional(),
    program: z.array(WorkoutDaySchema).optional(),
    goals: z.array(z.string()).optional(),
    notes: z.string().optional(),
  })
  .passthrough();

export const SessionResponseSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    duration: z.union([z.number(), z.string()]).optional(),
    exercises: z.array(ExerciseSchema).optional(),
    warmup: z.array(ExerciseSchema).optional(),
    cooldown: z.array(ExerciseSchema).optional(),
    notes: z.string().optional(),
  })
  .passthrough();

type ProgramResponse = z.infer<typeof ProgramResponseSchema>;
type SessionResponse = z.infer<typeof SessionResponseSchema>;

function validateProgram(data: unknown): { valid: boolean; data: ProgramResponse } {
  const result = ProgramResponseSchema.safeParse(data);
  if (!result.success) {
    console.warn(
      "[TrainChat] Program response failed validation:",
      result.error.issues.slice(0, 3)
    );
    return { valid: false, data: (data ?? {}) as ProgramResponse };
  }
  return { valid: true, data: result.data };
}

function validateSession(data: unknown): { valid: boolean; data: SessionResponse } {
  const result = SessionResponseSchema.safeParse(data);
  if (!result.success) {
    console.warn(
      "[TrainChat] Session response failed validation:",
      result.error.issues.slice(0, 3)
    );
    return { valid: false, data: (data ?? {}) as SessionResponse };
  }
  return { valid: true, data: result.data };
}

// ─── Platform-key usage logging (Priority 5 addition, fire-and-forget) ────────

async function logPlatformKeyUsage(orgId: string, endpoint: string, latencyMs: number): Promise<void> {
  try {
    const { appSettings } = await import("@shared/schema");
    const { sql } = await import("drizzle-orm");
    const key = `trainchat_usage_${orgId}`;
    const value = JSON.stringify({ lastEndpoint: endpoint, lastCalledAt: new Date().toISOString(), lastLatencyMs: latencyMs });
    await db.execute(sql`
      INSERT INTO app_settings (key, value) VALUES (${key}, ${value})
      ON CONFLICT (key) DO UPDATE SET value = ${value}
    `).catch(() => {});
  } catch {}
}

// ─── OpenAI Fallbacks (Priority 5 addition) ───────────────────────────────────

async function generateProgramViaOpenAI(params: unknown): Promise<unknown> {
  const openai = (await import("openai")).default;
  const client = new openai({ apiKey: process.env.OPENAI_API_KEY });
  const p = params as Record<string, unknown>;

  const prompt = `Generate a strength and conditioning program as JSON.
Sport: ${p.sport ?? "general fitness"}
Duration: ${p.weeks ?? 4} weeks, ${p.sessions_per_week ?? 3} sessions/week
Goals: ${Array.isArray(p.goals) ? (p.goals as string[]).join(", ") : (p.goals ?? "general fitness")}
Level: ${p.level ?? "intermediate"}

Return ONLY a JSON object: { name, weeks, sessions_per_week, goals, workouts: [{day, name, focus, exercises: [{name, sets, reps, rest, notes}]}] }`;

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    max_tokens: 2000,
  });
  try {
    return JSON.parse(completion.choices[0]?.message?.content ?? "{}");
  } catch {
    return { name: "AI Generated Program", weeks: p.weeks ?? 4, workouts: [] };
  }
}

async function generateSessionViaOpenAI(params: unknown): Promise<unknown> {
  const openai = (await import("openai")).default;
  const client = new openai({ apiKey: process.env.OPENAI_API_KEY });
  const p = params as Record<string, unknown>;

  const prompt = `Generate a single training session as JSON.
Sport: ${p.sport ?? "general fitness"}, Duration: ${p.duration ?? 60} min, Focus: ${p.focus ?? "full body"}, Level: ${p.level ?? "intermediate"}

Return ONLY JSON: { name, duration, exercises: [{name, sets, reps, rest, notes}], warmup: [], cooldown: [], notes }`;

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    max_tokens: 1000,
  });
  try {
    return JSON.parse(completion.choices[0]?.message?.content ?? "{}");
  } catch {
    return { name: "AI Generated Session", duration: p.duration ?? 60, exercises: [] };
  }
}

// ─── Core fetch (extended with usage logging) ─────────────────────────────────

async function tcFetch(
  orgId: string,
  path: string,
  method = "GET",
  body?: unknown
): Promise<{ data: unknown; latencyMs: number }> {
  const { baseUrl, apiKey } = await getDecryptedClient(orgId);
  const start = Date.now();
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const latencyMs = Date.now() - start;
  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`TrainChat API error ${res.status}: ${errText}`);
  }
  const data = await res.json().catch(() => null);

  // Log usage (fire-and-forget)
  logPlatformKeyUsage(orgId, path, latencyMs).catch(() => {});

  return { data, latencyMs };
}

// ─── Test connection (original, unchanged) ────────────────────────────────────

export async function testConnection(
  baseUrl: string,
  apiKey: string
): Promise<{ success: boolean; latencyMs: number; message: string }> {
  const start = Date.now();
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/external/docs`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });
    const latencyMs = Date.now() - start;
    if (res.ok) return { success: true, latencyMs, message: "Connection successful" };
    if (res.status === 401 || res.status === 403)
      return { success: false, latencyMs, message: "Invalid API key or insufficient permissions" };
    if (res.status === 404)
      return { success: true, latencyMs, message: "Connected (endpoint not found, but auth passed)" };
    return { success: false, latencyMs, message: `Unexpected status: ${res.status}` };
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    if (err?.cause?.code === "ECONNREFUSED" || err?.cause?.code === "ENOTFOUND")
      return { success: false, latencyMs, message: "Could not reach TrainChat — check your base URL" };
    return { success: false, latencyMs, message: err?.message ?? "Connection failed" };
  }
}

// ─── Client (extended with validation + fallback) ─────────────────────────────

export const trainChatClient = {
  async generateProgram(
    orgId: string,
    params: unknown
  ): Promise<{ data: unknown; latencyMs: number; validated?: boolean; usedFallback?: boolean }> {
    try {
      const { data, latencyMs } = await tcFetch(orgId, "/api/external/programs/generate", "POST", params);
      const { valid, data: validatedData } = validateProgram(data);
      return { data: validatedData, latencyMs, validated: valid, usedFallback: false };
    } catch (err: any) {
      console.warn(
        `[TrainChat] generateProgram failed for org ${orgId}: ${err.message} — trying OpenAI fallback`
      );
      if (!process.env.OPENAI_API_KEY) throw err;
      const start = Date.now();
      const data = await generateProgramViaOpenAI(params);
      return { data, latencyMs: Date.now() - start, validated: false, usedFallback: true };
    }
  },

  async editProgram(orgId: string, programId: string, params: unknown) {
    return tcFetch(orgId, `/api/external/programs/${programId}/edit`, "PATCH", params);
  },

  async generateSession(
    orgId: string,
    params: unknown
  ): Promise<{ data: unknown; latencyMs: number; validated?: boolean; usedFallback?: boolean }> {
    try {
      const { data, latencyMs } = await tcFetch(orgId, "/api/external/sessions/generate", "POST", params);
      const { valid, data: validatedData } = validateSession(data);
      return { data: validatedData, latencyMs, validated: valid, usedFallback: false };
    } catch (err: any) {
      console.warn(
        `[TrainChat] generateSession failed for org ${orgId}: ${err.message} — trying OpenAI fallback`
      );
      if (!process.env.OPENAI_API_KEY) throw err;
      const start = Date.now();
      const data = await generateSessionViaOpenAI(params);
      return { data, latencyMs: Date.now() - start, validated: false, usedFallback: true };
    }
  },

  async swapExercise(orgId: string, params: unknown) {
    return tcFetch(orgId, "/api/external/exercises/swap", "POST", params);
  },

  async explainProgram(orgId: string, programId: string) {
    return tcFetch(orgId, `/api/external/programs/${programId}/explain`);
  },

  async getProgram(orgId: string, programId: string) {
    return tcFetch(orgId, `/api/external/programs/${programId}`);
  },

  async listExercises(orgId: string, query?: string) {
    const qs = query ? `?q=${encodeURIComponent(query)}` : "";
    return tcFetch(orgId, `/api/external/exercises${qs}`);
  },
};
