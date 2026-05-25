/**
 * Shared email timestamp formatter.
 *
 * Converts a UTC Date (or ISO string) to a human-readable local time string
 * for use inside outbound emails. DB timestamps are stored in UTC and must
 * remain untouched — this function is display-only.
 *
 * Default timezone: America/New_York (handles both EST and EDT automatically
 * via IANA rules — never hardcode "EST").
 *
 * Example:
 *   formatEmailTimestamp(new Date("2026-05-25T22:24:00Z"))
 *   → "Monday, May 25, 2026 at 6:24 PM EDT"
 */
export function formatEmailTimestamp(
  date: Date | string,
  timezone: string = "America/New_York"
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(d);
}

// ── Self-test (runs once at import time in non-production for verification) ──
if (process.env.NODE_ENV !== "production") {
  const testUtc = "2026-05-25T22:24:00Z";
  const result = formatEmailTimestamp(testUtc);
  const expected = "Monday, May 25, 2026";
  if (result.includes(expected) && result.includes("6:24") && result.includes("EDT")) {
    console.log(`[formatEmailTimestamp] ✓ Self-test passed: "${result}"`);
  } else {
    console.warn(`[formatEmailTimestamp] ✗ Self-test FAILED. Got: "${result}"`);
  }
}
