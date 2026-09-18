/**
 * Duplicate suppression for the two unauthenticated intake endpoints.
 * ─────────────────────────────────────────────────────────────────────────────
 *   POST /api/public/lead-capture/:orgSlug/:programSlug/submit   (server/routes.ts)
 *   POST /api/attendance/checkin/:slug                           (server/attendance-routes.ts)
 *
 * Neither had auth, a rate limit, or any duplicate check. Each lead-capture POST
 * inserted a row unconditionally and then sent three emails (org admin, the
 * attacker-supplied applicant address, a high-intent alert), called OpenAI, and
 * enrolled a multi-step nurture sequence. That is an unauthenticated email relay
 * and unbounded spend on someone else's card.
 *
 * The shape of the fix is the one server/book-funnel-routes.ts already uses for
 * POST /api/book-funnel/leads: normalize the email, look for a recent row with
 * the same key, and reuse it instead of creating a second one.
 */

export const DEDUP_WINDOW_HOURS = 24;

/** Lowercased, trimmed. The only form an email should ever be compared in. */
export function normalizeIntakeEmail(email: unknown): string {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

/** Anything with drizzle's `execute` — the real db, or a stub in a test. */
export interface SqlExecutor {
  execute: (query: any) => Promise<any>;
}

export function resultRows(result: unknown): any[] {
  if (Array.isArray(result)) return result;
  const r = result as any;
  return Array.isArray(r?.rows) ? r.rows : [];
}

/**
 * The most recent lead_capture_submissions row for (program, normalized email)
 * inside the window, or null.
 *
 * Matching is case-insensitive on the stored column too: rows written before
 * this PR were inserted with whatever casing the form posted.
 */
export async function findRecentSubmission(
  executor: SqlExecutor,
  params: { orgId: string; programId: string; email: string; windowHours?: number },
  sqlTag: (strings: TemplateStringsArray, ...values: any[]) => any,
): Promise<{ id: string; created_at?: Date } | null> {
  const email = normalizeIntakeEmail(params.email);
  if (!email) return null;
  const hours = params.windowHours ?? DEDUP_WINDOW_HOURS;
  const found = resultRows(
    await executor.execute(sqlTag`
      SELECT id, created_at FROM lead_capture_submissions
      WHERE org_id = ${params.orgId}
        AND program_id = ${params.programId}
        AND LOWER(email) = ${email}
        AND created_at > NOW() - (${hours} * INTERVAL '1 hour')
      ORDER BY created_at DESC
      LIMIT 1
    `),
  )[0];
  return found ?? null;
}

/**
 * The most recent attendance_records row for (program, normalized email)
 * inside the window, or null. A second kiosk scan of the same QR code by the
 * same athlete on the same day is a double-tap, not a second visit.
 */
export async function findRecentAttendance(
  executor: SqlExecutor,
  params: { programId: string; email: string; windowHours?: number },
  sqlTag: (strings: TemplateStringsArray, ...values: any[]) => any,
): Promise<{ id: string; visit_number?: number } | null> {
  const email = normalizeIntakeEmail(params.email);
  if (!email) return null;
  const hours = params.windowHours ?? DEDUP_WINDOW_HOURS;
  const found = resultRows(
    await executor.execute(sqlTag`
      SELECT id, visit_number FROM attendance_records
      WHERE program_id = ${params.programId}
        AND LOWER(athlete_email) = ${email}
        AND created_at > NOW() - (${hours} * INTERVAL '1 hour')
      ORDER BY created_at DESC
      LIMIT 1
    `),
  )[0];
  return found ?? null;
}
