/**
 * authenticatedFetch — single canonical utility for all authenticated API calls.
 *
 * Automatically:
 *   - includes Authorization: Bearer <token> via getAuthHeaders()
 *   - includes credentials: "include" (for session-cookie / OIDC users)
 *   - throws with a standardised "STATUS: message" error string on non-2xx
 *   - parses and returns JSON; handles 204 / empty body gracefully
 *
 * Usage:
 *   const data = await authenticatedFetch<MyType>("/api/some/endpoint");
 *   const data = await authenticatedFetch<MyType>("/api/endpoint", {
 *     method: "POST",
 *     headers: { "Content-Type": "application/json" },
 *     body: JSON.stringify(payload),
 *   });
 *
 * For calls where a failure should return null instead of throwing:
 *   const data = await authenticatedFetch<MyType>(url).catch(() => null);
 */

import { getAuthHeaders } from "./authToken";

export async function authenticatedFetch<T = any>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const { headers: extraHeaders, ...rest } = options ?? {};

  const res = await fetch(url, {
    credentials: "include",
    ...rest,
    headers: {
      ...getAuthHeaders(),
      ...(extraHeaders as Record<string, string> | undefined),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = String(res.status);
    try {
      const body = JSON.parse(text) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      if (text.trim()) message = text.trim().slice(0, 200);
    }
    throw new Error(`${res.status}: ${message}`);
  }

  if (res.status === 204) return {} as T;
  const text = await res.text().catch(() => "");
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `Failed to parse API response (HTTP ${res.status}): ${text.slice(0, 120)}`
    );
  }
}
