import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { recordCronRun } from "@/lib/cron-runs";
import { runCuration } from "@/lib/beacon-brief/curate";

function bearerMatches(auth: string, secret: string): boolean {
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(auth);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/beacon-brief
 *
 * Vercel Cron entry point for the Beacon Brief curation pass (every 5 minutes,
 * scheduled in vercel.json). Accepts the Vercel cron auth header
 * (`Authorization: Bearer <CRON_SECRET>`) and refuses anything else, so it cannot
 * be triggered from the public internet. Runs the fast path only (ingest, score,
 * route, enqueue); the worker cron does the slow Discord/AI work.
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
  if (!bearerMatches(auth, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  try {
    const result = await recordCronRun(supabase, "beacon-brief-curate", () =>
      runCuration(supabase),
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/beacon-brief] failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
