import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { runKtcSync } from "@/lib/sync-ktc";
import { recordCronRun } from "@/lib/cron-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/sync-ktc
 *
 * Vercel Cron entry point for the KTC daily value sync. Scheduled in
 * vercel.json. The handler accepts the Vercel cron-style auth header
 * (`Authorization: Bearer <CRON_SECRET>`) and refuses anything else, so the
 * endpoint cannot be triggered from the public internet.
 *
 * Calls runKtcSync() — the same code path scripts/sync-ktc.ts runs locally.
 * Returns a JSON sync report so Vercel's cron log surfaces the row counts.
 */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  try {
    const result = await recordCronRun(supabase, "sync-ktc", () =>
      runKtcSync(supabase),
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/sync-ktc] failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
