/**
 * Optional remediation for phantom auto-pilot rows.
 *
 * Before this fix, level-3 automation wrote agent_actions rows with
 * status='sent' and auto_sent=true without ever calling a provider (see
 * server/action-tracking.ts). Those clients received nothing, and because the
 * human send path only accepts status='pending', the rows could never be sent
 * by a coach either. This script re-marks them as what they always were:
 * drafts waiting for approval.
 *
 * Nothing is run automatically. Count first, then decide:
 *
 *   SELECT organization_id, count(*) AS phantom_rows, min(created_at), max(created_at)
 *     FROM agent_actions
 *    WHERE auto_sent = true AND status = 'sent' AND sent_at IS NULL
 *    GROUP BY organization_id
 *    ORDER BY phantom_rows DESC;
 *
 * Then, against the intended database only:
 *
 *   DATABASE_URL=... node --import tsx server/scripts/requeue-phantom-auto-sent-actions.ts            # dry run
 *   DATABASE_URL=... node --import tsx server/scripts/requeue-phantom-auto-sent-actions.ts --apply    # writes
 *   DATABASE_URL=... node --import tsx server/scripts/requeue-phantom-auto-sent-actions.ts --apply --org <id>
 *
 * sent_at IS NULL is the safety condition: a row a real send delivered carries
 * the marker and is never touched. Rows this script re-queues become visible to
 * the coach, who decides whether the message is still worth sending — the
 * script deliberately does not send anything.
 */
import { pool } from "../db";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const orgIndex = args.indexOf("--org");
const orgId = orgIndex >= 0 ? args[orgIndex + 1] : undefined;

const REQUEUE_REASON =
  "re-queued: recorded as sent by level-3 automation but never delivered — review before sending";

async function main() {
  const filters = ["auto_sent = true", "status = 'sent'", "sent_at IS NULL"];
  const params: string[] = [];
  if (orgId) {
    params.push(orgId);
    filters.push(`organization_id = $${params.length}`);
  }
  const where = filters.join(" AND ");

  const counted = await pool.query(
    `SELECT organization_id, count(*)::int AS phantom_rows FROM agent_actions WHERE ${where} GROUP BY organization_id ORDER BY phantom_rows DESC`,
    params,
  );

  const total = counted.rows.reduce((sum, row) => sum + row.phantom_rows, 0);
  console.log(`phantom auto-sent rows: ${total}${orgId ? ` (org ${orgId})` : ""}`);
  for (const row of counted.rows) console.log(`  ${row.organization_id}: ${row.phantom_rows}`);

  if (!apply) {
    console.log("\ndry run — nothing written. Re-run with --apply to re-queue these rows as 'pending'.");
    return;
  }

  const updated = await pool.query(
    `UPDATE agent_actions
        SET status = 'pending',
            auto_sent = false,
            auto_reason = $${params.length + 1}
      WHERE ${where}
      RETURNING id`,
    [...params, REQUEUE_REASON],
  );
  console.log(`re-queued ${updated.rowCount} row(s) as pending.`);
}

main()
  .catch((error) => {
    console.error("FAILED", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
