import crypto from "crypto";
import { db } from "../db";
import { orgAiIntegrations } from "@shared/schema";
import { eq, and } from "drizzle-orm";

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

async function getIntegration(orgId: string, provider: string) {
  const [row] = await db
    .select()
    .from(orgAiIntegrations)
    .where(and(eq(orgAiIntegrations.orgId, orgId), eq(orgAiIntegrations.provider, provider)))
    .limit(1);
  return row ?? null;
}

async function getDecryptedClient(orgId: string): Promise<{ baseUrl: string; apiKey: string }> {
  const integration = await getIntegration(orgId, "trainchat");
  if (!integration || !integration.isActive) throw new Error("TrainChat integration is not connected for this organization");
  if (!integration.apiKeyEncrypted) throw new Error("No API key stored for TrainChat");
  if (!integration.apiBaseUrl) throw new Error("No base URL stored for TrainChat");
  const apiKey = decryptApiKey(integration.apiKeyEncrypted);
  return { baseUrl: integration.apiBaseUrl.replace(/\/$/, ""), apiKey };
}

async function tcFetch(orgId: string, path: string, method = "GET", body?: unknown): Promise<{ data: unknown; latencyMs: number }> {
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
  return { data, latencyMs };
}

export async function testConnection(baseUrl: string, apiKey: string): Promise<{ success: boolean; latencyMs: number; message: string }> {
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
    if (res.ok) {
      return { success: true, latencyMs, message: "Connection successful" };
    }
    if (res.status === 401 || res.status === 403) {
      return { success: false, latencyMs, message: "Invalid API key or insufficient permissions" };
    }
    if (res.status === 404) {
      return { success: true, latencyMs, message: "Connected (endpoint not found, but auth passed)" };
    }
    return { success: false, latencyMs, message: `Unexpected status: ${res.status}` };
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    if (err?.cause?.code === "ECONNREFUSED" || err?.cause?.code === "ENOTFOUND") {
      return { success: false, latencyMs, message: "Could not reach TrainChat — check your base URL" };
    }
    return { success: false, latencyMs, message: err?.message ?? "Connection failed" };
  }
}

export const trainChatClient = {
  async generateProgram(orgId: string, params: unknown) {
    return tcFetch(orgId, "/api/external/programs/generate", "POST", params);
  },
  async editProgram(orgId: string, programId: string, params: unknown) {
    return tcFetch(orgId, `/api/external/programs/${programId}/edit`, "PATCH", params);
  },
  async generateSession(orgId: string, params: unknown) {
    return tcFetch(orgId, "/api/external/sessions/generate", "POST", params);
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
