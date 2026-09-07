/**
 * Send the donation receipts that never went out.
 *
 * WHY THIS EXISTS
 *   Stripe gives up retrying a webhook after about three days, and two of the
 *   route's outcomes deliberately answer 200 before a receipt has been sent: a
 *   send deferred because the email provider was unconfigured, and a send that
 *   failed enough times to hit the attempt ceiling. Both leave a row that is
 *   still claimable and nothing left to claim it. This is that something.
 *
 *   Without it, a deployment window where RESEND_API_KEY was missing produces
 *   donations that took real money, promised a receipt on /donate/thanks and in
 *   the Privacy Policy, and can never send one.
 *
 * WHERE THE ADDRESS COMES FROM
 *   Not from our database, because it is not there. `donation_receipts` holds no
 *   donor identity by design (migration 0270), so this fetches the Checkout
 *   Session back from Stripe using the stored session id, reads the address,
 *   sends, and drops it. Stripe is the system of record, which is the entire
 *   argument for not keeping a second copy.
 *
 * SAFETY
 *   It claims each row through the same `try_claim_donation_receipt` the webhook
 *   uses, so it cannot race a live delivery and cannot send a second copy of a
 *   receipt that already went out. A row past the attempt ceiling is reported
 *   and left alone rather than hammered further.
 *
 *   Run with `--dry` first. It reports exactly what it would send and writes
 *   nothing.
 *
 * Usage:
 *   npm run donate:receipts -- --dry
 *   npm run donate:receipts
 *   npm run donate:receipts -- --limit 50
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";
import { retrieveCheckoutSession } from "../lib/donate/stripe";
import { sendDonationReceipt } from "../lib/email/donation-emails";

const DRY = process.argv.includes("--dry");
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) || 100 : 100;

/** Same masking rule as lib/email/send.ts: never print a donor's address. */
function mask(address: string): string {
  const at = address.lastIndexOf("@");
  return at <= 0 ? "***" : `${address[0]}***${address.slice(at)}`;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  }
  const supabase = createClient<Database>(url, key, {
    auth: { persistSession: false },
  });

  const { data: rows, error } = await supabase
    .from("donation_receipts")
    .select("stripe_session_id, amount_total_cents, status, attempts, created_at")
    .is("receipt_sent_at", null)
    .in("status", ["pending", "failed", "deferred", "sending"])
    .order("created_at", { ascending: true })
    .limit(LIMIT);

  if (error) throw new Error(`could not read the ledger: ${error.message}`);
  if (!rows || rows.length === 0) {
    console.log("Nothing outstanding. Every donation has its receipt.");
    return;
  }

  console.log(
    `${rows.length} donation${rows.length === 1 ? "" : "s"} with no receipt yet${
      DRY ? " (dry run, nothing will be sent)" : ""
    }:`,
  );

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of rows) {
    const id = row.stripe_session_id;
    const label = `${id} (${(row.amount_total_cents / 100).toFixed(2)} USD, ${row.status}, ${row.attempts} attempts)`;

    // The address is not ours to store, so ask Stripe for it now.
    const session = await retrieveCheckoutSession(id);
    if (!session.ok) {
      console.log(`  skip  ${label}: could not read the session from Stripe`);
      skipped += 1;
      continue;
    }
    const email = session.data.customer_details?.email ?? null;
    if (!email) {
      console.log(`  skip  ${label}: the session carries no email address`);
      if (!DRY) {
        await supabase
          .from("donation_receipts")
          .update({
            status: "skipped",
            last_error: "no email address on the session",
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_session_id", id);
      }
      skipped += 1;
      continue;
    }

    if (DRY) {
      console.log(`  would send  ${label} -> ${mask(email)}`);
      continue;
    }

    // The same claim the webhook takes, so a live delivery cannot be raced.
    const { data: claimed, error: claimError } = await supabase.rpc(
      "try_claim_donation_receipt",
      { p_session_id: id },
    );
    if (claimError) {
      console.log(`  fail  ${label}: claim failed, ${claimError.message}`);
      failed += 1;
      continue;
    }
    if (!claimed) {
      console.log(`  skip  ${label}: not claimable (in flight, or past the attempt ceiling)`);
      skipped += 1;
      continue;
    }

    const result = await sendDonationReceipt({
      to: email,
      amountCents: row.amount_total_cents,
      reference: id,
      // The row's own creation time is the closest thing to the payment time
      // available here, and it is written when the webhook first saw the event.
      paidAtIso: row.created_at,
    });

    if (result.ok) {
      await supabase
        .from("donation_receipts")
        .update({
          status: "sent",
          receipt_sent_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("stripe_session_id", id);
      console.log(`  sent  ${label} -> ${mask(email)}`);
      sent += 1;
    } else {
      const deferred = "skipped" in result && result.skipped === true;
      const reason = deferred
        ? "email provider not configured"
        : "error" in result
          ? result.error
          : "send failed";
      await supabase
        .from("donation_receipts")
        .update({
          status: deferred ? "deferred" : "failed",
          last_error: reason,
          updated_at: new Date().toISOString(),
        })
        .eq("stripe_session_id", id);
      console.log(`  fail  ${label}: ${reason}`);
      failed += 1;
    }
  }

  if (!DRY) {
    console.log(`\nSent ${sent}, failed ${failed}, skipped ${skipped}.`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
