import { createHash } from "node:crypto";
import { NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getTrustedClientIp } from "@/lib/client-ip";
import { sendEmail } from "@/lib/email/send";
import { buildFormatReportEmail } from "@/lib/email/report-emails";
import { validateFormatReportInput } from "@/lib/on-the-clock/report-validate";

/**
 * POST /api/on-the-clock/report-format
 *
 * A visitor reports that On The Clock detected the wrong format for their Sleeper
 * league. We email the report to the team. Defenses, in order:
 *   1. Same-origin check (cheap CSRF/forgery guard for this state-changing POST).
 *   2. Honeypot: a non-empty hidden `company` field means a bot; reject generically.
 *   3. Shared server-side validation (same rules as the client dialog).
 *   4. DURABLE per-IP rate limit (FFB-SEC-011): a DB-backed fixed window keyed by a
 *      hashed, trusted client IP, so the cap holds across serverless instances instead
 *      of the old per-instance in-memory window that multiplied across cold starts.
 * The email is sent inside after() so a slow provider never adds request latency.
 */

export const runtime = "nodejs";

const RATE_WINDOW_SECONDS = 10 * 60;
const RATE_MAX = 4;
const RATE_BUCKET = "otc_report_format";

const HONEYPOT_MESSAGE =
  "Unable to complete request. Please contact our support team at michael@ffbeacon.com or join our Discord for assistance.";

const ADMIN_EMAIL = process.env.ADMIN_NOTIFICATION_EMAIL ?? "michael@ffbeacon.com";

/** Hashed, trusted client IP used as the durable rate-limit key (no raw IP stored). */
function rateLimitKey(req: Request): string {
  return createHash("sha256").update(getTrustedClientIp(req)).digest("hex");
}

function sameOrigin(req: Request): boolean {
  const selfHost = new URL(req.url).host;
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host === selfHost;
    } catch {
      return false;
    }
  }
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).host === selfHost;
    } catch {
      return false;
    }
  }
  // Neither header present: fail closed (this endpoint sends email).
  return false;
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ ok: false, error: "Request blocked." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const raw = (body ?? {}) as Record<string, unknown>;

  // Honeypot: real users never see or fill this field.
  if (typeof raw.company === "string" && raw.company.trim().length > 0) {
    return NextResponse.json({ ok: false, error: HONEYPOT_MESSAGE }, { status: 400 });
  }

  const v = validateFormatReportInput({
    reporterName: raw.reporterName,
    reporterEmail: raw.reporterEmail,
    sleeperUsername: raw.sleeperUsername,
    leagueName: raw.leagueName,
    leagueId: raw.leagueId,
    draftId: raw.draftId,
    season: raw.season,
    totalRosters: raw.totalRosters,
    draftStatus: raw.draftStatus,
    assignedFormatLabel: raw.assignedFormatLabel,
    assignedFormatSlug: raw.assignedFormatSlug,
    derivedFormatLabel: raw.derivedFormatLabel,
    isClosestMatch: raw.isClosestMatch,
    details: raw.details,
  });
  if (!v.ok) {
    return NextResponse.json({ ok: false, error: v.error }, { status: 400 });
  }

  // Durable per-IP limit. Fail closed: if the check cannot be evaluated, do not email.
  const admin = createAdminClient();
  let allowed: boolean;
  try {
    const { data, error } = await admin.rpc("try_claim_rate_limit" as never, {
      p_bucket: RATE_BUCKET,
      p_key: rateLimitKey(req),
      p_max_requests: RATE_MAX,
      p_window_seconds: RATE_WINDOW_SECONDS,
    } as never);
    if (error) throw new Error(error.message);
    allowed = Boolean(data);
  } catch (err) {
    console.error("[on-the-clock/report-format] rate-limit check failed", err);
    return NextResponse.json({ ok: false, error: "Try again in a moment." }, { status: 503 });
  }
  if (!allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: "You have sent several reports in a short time. Please wait a few minutes and try again.",
      },
      { status: 429 },
    );
  }

  // Send AFTER responding so a slow/down email provider never adds latency. The
  // reporter's own address is the reply-to so the team can respond directly.
  const data = v.value;
  after(async () => {
    const mail = buildFormatReportEmail(data);
    await sendEmail({
      to: ADMIN_EMAIL,
      subject: `Incorrect format reported: ${data.leagueName}`,
      html: mail.html,
      text: mail.text,
      replyTo: data.reporterEmail,
    });
  });

  return NextResponse.json({ ok: true });
}
