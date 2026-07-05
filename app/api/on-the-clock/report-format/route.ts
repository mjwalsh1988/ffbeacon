import { createHash } from "node:crypto";
import { NextResponse, after } from "next/server";
import { sendEmail } from "@/lib/email/send";
import { buildFormatReportEmail } from "@/lib/email/report-emails";
import { validateFormatReportInput } from "@/lib/on-the-clock/report-validate";

/**
 * POST /api/on-the-clock/report-format
 *
 * A visitor reports that On The Clock detected the wrong format for their Sleeper
 * league. We email the report to the team; there is no DB write (the report is a
 * one-off notification, not a queued record). Defenses, in order:
 *   1. Same-origin check (cheap CSRF/forgery guard for this state-changing POST).
 *   2. Honeypot: a non-empty hidden `company` field means a bot; reject generically.
 *   3. Shared server-side validation (same rules as the client dialog).
 *   4. Coarse per-IP rate limit (hashed IP, in-memory rolling window) so a script
 *      cannot spam the team inbox. In-memory is best-effort on serverless (state is
 *      per-instance) but pairs with the same-origin + honeypot guards; this endpoint
 *      writes no database rows and sends only to the fixed team address, so the blast
 *      radius of the weak limit is one inbox, not user data.
 * The email is sent inside after() so a slow provider never adds request latency.
 */

export const runtime = "nodejs";

const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 4;

const HONEYPOT_MESSAGE =
  "Unable to complete request. Please contact our support team at michael@ffbeacon.com or join our Discord for assistance.";

const ADMIN_EMAIL = process.env.ADMIN_NOTIFICATION_EMAIL ?? "michael@ffbeacon.com";

// Per-instance rolling window of report timestamps keyed by hashed IP. Best-effort
// abuse guard; see the route header for why in-memory is acceptable here.
const recentByIp = new Map<string, number[]>();

function clientIpHash(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  const ip = (fwd ? fwd.split(",")[0] : req.headers.get("x-real-ip"))?.trim();
  if (!ip) return null;
  return createHash("sha256").update(ip).digest("hex");
}

/** Returns true when this IP is over the limit; records the attempt when allowed. */
function isRateLimited(ipHash: string | null): boolean {
  if (!ipHash) return false;
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const hits = (recentByIp.get(ipHash) ?? []).filter((t) => t > cutoff);
  if (hits.length >= RATE_MAX) {
    recentByIp.set(ipHash, hits);
    return true;
  }
  hits.push(now);
  recentByIp.set(ipHash, hits);
  // Opportunistic cleanup so the map cannot grow unbounded across cold-lived instances.
  if (recentByIp.size > 5000) {
    for (const [key, times] of recentByIp) {
      if (times.every((t) => t <= cutoff)) recentByIp.delete(key);
    }
  }
  return false;
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

  if (isRateLimited(clientIpHash(req))) {
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
