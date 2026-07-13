import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyCronRequest } from "@/lib/cron-auth";
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
  const cronAuth = verifyCronRequest(req);
  if (!cronAuth.ok) {
    return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
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
