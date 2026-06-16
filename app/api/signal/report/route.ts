import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

/**
 * POST /api/signal/report
 *
 * Report (flag) a Wall post or comment. Writes to the polymorphic signal_reports
 * table (migration 0070). The admin moderation queue reads these.
 *
 * Hardening:
 *   - same-origin only (x-requested-with header), matching the media route.
 *   - auth required; anonymous reporting is not allowed (RLS also blocks anon).
 *   - per-reporter rate limit: min 15s between reports, max 10 per rolling hour,
 *     max 40 per rolling day. Enforced here (not a trigger), mirroring the post
 *     limits, because reports are written by many users across many targets.
 *   - the target must be publicly reportable: the post must exist, not be
 *     hidden, and its parent Signal must be live (published + public + not
 *     hidden). This stops reporting of arbitrary or non-public ids.
 *   - one report per (target, reporter) via the unique constraint; a repeat
 *     returns a friendly "already reported" rather than an error.
 *
 * The insert uses the caller's session client so the insert-own RLS policy
 * authorizes it; the target lookup uses the admin client because draft/hidden
 * rows are invisible to the reporter's RLS.
 */

export const runtime = "nodejs";

const VALID_REASONS = ["spam", "harassment", "hate", "sexual", "violence", "other"];
const DETAILS_MAX = 1000;

function isSameOrigin(req: Request): boolean {
  return req.headers.get("x-requested-with") === "ff-beacon";
}

export async function POST(req: Request) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 403 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to report content." }, { status: 401 });
  }

  let payload: {
    targetType?: unknown;
    targetId?: unknown;
    reason?: unknown;
    details?: unknown;
  };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const targetType = String(payload.targetType ?? "");
  const targetId = String(payload.targetId ?? "");
  const reason = String(payload.reason ?? "");
  const detailsRaw =
    typeof payload.details === "string" ? payload.details.trim() : "";

  // Comments arrive in sub-phase (c); only posts are reportable today.
  if (targetType !== "post") {
    return NextResponse.json({ error: "That content cannot be reported." }, { status: 400 });
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetId)
  ) {
    return NextResponse.json({ error: "That content cannot be reported." }, { status: 400 });
  }
  if (!VALID_REASONS.includes(reason)) {
    return NextResponse.json({ error: "Choose a reason for the report." }, { status: 400 });
  }
  if (detailsRaw.length > DETAILS_MAX) {
    return NextResponse.json(
      { error: `Details must be ${DETAILS_MAX} characters or fewer.` },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // Target must be a real, publicly viewable post.
  const { data: post } = await admin
    .from("signal_posts")
    .select("id, hidden, signals!inner(status, visibility, hidden)")
    .eq("id", targetId)
    .maybeSingle();
  const parent = post?.signals as unknown as
    | { status: string; visibility: string; hidden: boolean }
    | null;
  if (
    !post ||
    post.hidden ||
    !parent ||
    parent.status !== "published" ||
    parent.visibility !== "public" ||
    parent.hidden
  ) {
    return NextResponse.json({ error: "That content cannot be reported." }, { status: 400 });
  }

  // Per-reporter rate limit across all of this reporter's reports.
  const now = Date.now();
  const { data: recent } = await admin
    .from("signal_reports")
    .select("created_at")
    .eq("reporter_user_id", user.id)
    .gte("created_at", new Date(now - 24 * 60 * 60 * 1000).toISOString());
  const times = (recent ?? []).map((r) => new Date(r.created_at).getTime());
  if (times.some((t) => t > now - 15 * 1000)) {
    return NextResponse.json(
      { error: "Slow down. Wait at least 15 seconds between reports." },
      { status: 429 },
    );
  }
  if (times.filter((t) => t > now - 60 * 60 * 1000).length >= 10) {
    return NextResponse.json(
      { error: "You have reported a lot recently. Try again later." },
      { status: 429 },
    );
  }
  if (times.length >= 40) {
    return NextResponse.json(
      { error: "You have reached the daily report limit. Try again tomorrow." },
      { status: 429 },
    );
  }

  const { error } = await supabase.from("signal_reports").insert({
    target_type: "post",
    target_id: targetId,
    reporter_user_id: user.id,
    reason,
    details: detailsRaw.length > 0 ? detailsRaw : null,
  });
  if (error) {
    // 23505 = unique violation: this reporter already reported this target.
    if (error.code === "23505") {
      return NextResponse.json({ ok: true, alreadyReported: true });
    }
    return NextResponse.json(
      { error: "Could not submit your report. Please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
