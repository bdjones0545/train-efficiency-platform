/**
 * Stripe Wallet Sync — Repair Script
 *
 * Usage:
 *   Dry run (safe, no changes):
 *     npx tsx script/stripe-wallet-repair.ts
 *
 *   Live run (applies credits):
 *     npx tsx script/stripe-wallet-repair.ts --live
 *
 *   Audit only (no changes, full report):
 *     npx tsx script/stripe-wallet-repair.ts --audit
 */

import { WebhookHandlers } from '../server/webhookHandlers';

const args = process.argv.slice(2);
const isLive = args.includes('--live');
const auditOnly = args.includes('--audit');
const dryRun = !isLive;

async function main() {
  console.log('='.repeat(60));
  console.log('Stripe Wallet Sync Repair Script');
  console.log('='.repeat(60));

  if (auditOnly) {
    console.log('\n[MODE] AUDIT — scanning last 30 days of Stripe payments\n');
    const result = await WebhookHandlers.stripeWalletSyncAudit(30);

    console.log(`\nSummary:`);
    console.log(`  Total successful Stripe payments: ${result.summary.total}`);
    console.log(`  Matched to TrainEfficiency users:  ${result.summary.matched}`);
    console.log(`  Already have ledger entry:         ${result.summary.credited}`);
    console.log(`  MISSING ledger entry:              ${result.summary.missing}`);

    console.log('\nDetailed results:');
    for (const p of result.payments) {
      const status = p.hasLedgerEntry ? '✓ CREDITED' : '✗ MISSING ';
      const user = p.matchedUserId ? `userId:${p.matchedUserId} (${p.matchedUserEmail})` : 'NO USER MATCH';
      console.log(
        `  ${status} | $${(p.amountCents / 100).toFixed(2).padStart(8)} | ${p.stripePaymentIntentId} | ${(p.customerEmail || p.customerName || 'unknown').padEnd(35)} | ${user}`
      );
    }

    return;
  }

  console.log(`\n[MODE] ${dryRun ? 'DRY RUN — no changes will be made' : 'LIVE — credits will be applied NOW'}\n`);

  if (!dryRun) {
    console.log('!! WARNING: This will modify wallet balances in the database. !!');
    console.log('!! Run without --live first to preview changes.               !!');
    console.log('');
    await new Promise(r => setTimeout(r, 3000));
  }

  const result = await WebhookHandlers.stripeWalletSyncRepair(dryRun);

  console.log('\nResults:');
  for (const r of result.repaired) {
    if (r.action === 'credited') {
      const prefix = dryRun ? '[DRY RUN] would credit' : '[CREDITED]';
      console.log(`  ${prefix} | $${(r.amountCents / 100).toFixed(2).padStart(8)} | ${r.stripePaymentIntentId} | userId:${r.userId} (${r.userEmail})`);
    } else if (r.action === 'skipped') {
      console.log(`  [SKIPPED]  | $${(r.amountCents / 100).toFixed(2).padStart(8)} | ${r.stripePaymentIntentId} | already credited`);
    } else if (r.action === 'no_user_match') {
      console.log(`  [NO MATCH] | $${(r.amountCents / 100).toFixed(2).padStart(8)} | ${r.stripePaymentIntentId} | email: ${r.userEmail || 'unknown'}`);
    }
  }

  console.log('\nSummary:');
  console.log(`  Total Stripe payments scanned: ${result.summary.total}`);
  console.log(`  ${dryRun ? 'Would credit' : 'Credited'}:             ${result.summary.credited}`);
  console.log(`  Already credited (skipped):    ${result.summary.skipped}`);
  console.log(`  No user match found:           ${result.summary.noMatch}`);

  if (dryRun && result.summary.credited > 0) {
    console.log(`\n→ To apply these ${result.summary.credited} credit(s), run:`);
    console.log('  npx tsx script/stripe-wallet-repair.ts --live');
  }

  console.log('\nDone.');
}

main().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});
