/**
 * Shared API response helpers for TanStack Query mutations.
 *
 * parseApiResponse<T>(res)
 *   Safe JSON parser for mutation `mutationFn` chains:
 *   - 204 No Content or empty body → returns {} as T (never throws)
 *   - Invalid JSON body → throws with context (never silent)
 *   - Valid JSON → typed parsed object
 *
 * getErrorMessage(error, fallback?)
 *   Extracts a human-readable string from any thrown value.
 *
 * parseApiError(error)
 *   Extracts { status, message } from apiRequest error strings ("404: Not Found").
 */

export async function parseApiResponse<T = Record<string, unknown>>(
  res: Response
): Promise<T> {
  if (res.status === 204) return {} as T;
  const text = await res.text();
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `Failed to parse API response (HTTP ${res.status}): ${text.slice(0, 120)}`
    );
  }
}

export function getErrorMessage(
  error: unknown,
  fallback = "An unexpected error occurred"
): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error != null && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return fallback;
}

export function parseApiError(error: unknown): {
  status: number | null;
  message: string;
} {
  const message = getErrorMessage(error);
  const match = message.match(/^(\d{3}):/);
  return {
    status: match ? parseInt(match[1], 10) : null,
    message: match ? message.slice(match[0].length).trim() : message,
  };
}
