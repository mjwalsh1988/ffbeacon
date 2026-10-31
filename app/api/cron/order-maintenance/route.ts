import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { recordCronRun } from "@/lib/cron-runs";
import { runOrderMaintenance } from "@/lib/commerce/maintenance";
import { loadCommerceSettings } from "@/lib/commerce/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/order-maintenance
 *
 * Hourly at minute 40. Expires unpaid orders, sends the one PayPal and Venmo
 * reminder, retries a receipt that did not go out, clears abandoned uploads and
 * prunes the webhook ledger (lib/commerce/maintenance.ts). Bounded by limits, it
 * iterates orders rather than leagues and recomputes nothing.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` only.
 */
export async function GET(req: Request) {
  const cronAuth = verifyCronRequest(req);
  if (!cronAuth.ok) {
    return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
  }

  const admin = createAdminClient();
  try {
    const result = await recordCronRun(admin, "order-maintenance", async () =>
      runOrderMaintenance(admin, await loadCommerceSettings(admin)),
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/order-maintenance] failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
