import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { runDynastyProcessSync } from "@/lib/sync-dynastyprocess";
import { recordCronRun } from "@/lib/cron-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/sync-dynastyprocess
 *
 * Vercel Cron entry point for the DynastyProcess daily value sync. Auth via
 * `Authorization: Bearer <CRON_SECRET>`. Returns a JSON sync report.
 */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  try {
    const result = await recordCronRun(supabase, "sync-dynastyprocess", () =>
      runDynastyProcessSync(supabase),
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/sync-dynastyprocess] failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
