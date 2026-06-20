import { createHash } from "node:crypto";
import { NextResponse, after } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { validateSubmissionInput } from "@/lib/guide/validate";
import { sendEmail } from "@/lib/email/send";
import { EMAIL_SITE_URL } from "@/lib/email/layout";
import {
  buildAdminNotificationEmail,
  buildAskerConfirmationEmail,
} from "@/lib/email/guide-emails";

/**
 * POST /api/guide/submit
 *
 * Public intake for the Signal Guide "I couldn't find my answer" form. Runs
 * entirely server-side with the service-role client (guide_question_submissions
 * has no client write policy). Defenses, in order:
 *   1. Same-origin check (cheap CSRF/forgery guard for this state-changing POST).
 *   2. Honeypot: a non-empty hidden `company` field means a bot; we reject with a
 *      deliberately generic message and never persist or email.
 *   3. Server-side validation mirroring the DB CHECK constraints.
 *   4. Coarse per-IP rate limit (hashed IP, 10-minute window).
 * On success it queues the row and fires two emails (team always; asker only when
 * they provided an address). Email failures never fail the request: the queue is
 * the source of truth.
 */

export const runtime = "nodejs";

const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;

const HONEYPOT_MESSAGE =
  "Unable to complete request. Please contact our support team at michael@ffbeacon.com or join our Discord for assistance.";

const ADMIN_EMAIL = process.env.ADMIN_NOTIFICATION_EMAIL ?? "michael@ffbeacon.com";

function clientIpHash(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  const ip = (fwd ? fwd.split(",")[0] : req.headers.get("x-real-ip"))?.trim();
  if (!ip) return null;
  return createHash("sha256").update(ip).digest("hex");
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
  // Some browsers omit Origin on same-origin POSTs; fall back to the Referer host.
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).host === selfHost;
    } catch {
      return false;
    }
  }
  // Neither header present: a real browser form POST always sends at least one, so
  // reject. This state-changing endpoint also sends email, so we fail closed.
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

  // Honeypot. Real users never see or fill this field. Generic message on trip so
  // we don't teach a bot what tripped it.
  if (typeof raw.company === "string" && raw.company.trim().length > 0) {
    return NextResponse.json({ ok: false, error: HONEYPOT_MESSAGE }, { status: 400 });
  }

  const v = validateSubmissionInput({
    pageKey: raw.pageKey,
    name: raw.name,
    email: raw.email,
    question: raw.question,
  });
  if (!v.ok) {
    return NextResponse.json({ ok: false, error: v.error }, { status: 400 });
  }

  const admin = createAdminClient();
  const ipHash = clientIpHash(req);

  // Coarse rate limit: cap submissions per IP in the rolling window.
  if (ipHash) {
    const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
    const { count } = await admin
      .from("guide_question_submissions")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", since);
    if ((count ?? 0) >= RATE_MAX) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "You have sent several questions in a short time. Please wait a few minutes and try again.",
        },
        { status: 429 },
      );
    }
  }

  // Capture the signed-in user for provenance (never trusted for authorization).
  let submittedUserId: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    submittedUserId = user?.id ?? null;
  } catch {
    submittedUserId = null;
  }

  const { data: inserted, error } = await admin
    .from("guide_question_submissions")
    .insert({
      page_key: v.value.pageKey,
      name: v.value.name,
      email: v.value.email,
      question: v.value.question,
      submitted_user_id: submittedUserId,
      ip_hash: ipHash,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    console.error("[guide/submit] insert failed", error);
    return NextResponse.json(
      { ok: false, error: "Something went wrong saving your question. Please try again." },
      { status: 500 },
    );
  }

  // Send emails AFTER responding so a slow/down email provider never adds latency
  // to the user's request. The submission row is already persisted (the source of
  // truth); email is best-effort and never fails the request. after() keeps the
  // work alive past the response on serverless instead of being killed mid-flight.
  const emailData = {
    name: v.value.name,
    email: v.value.email,
    question: v.value.question,
    pageKey: v.value.pageKey,
  };

  const reviewUrl = `${EMAIL_SITE_URL}/admin/signal-guide/${encodeURIComponent(
    v.value.pageKey,
  )}?submission=${inserted.id}`;

  after(async () => {
    const adminMail = buildAdminNotificationEmail({ ...emailData, reviewUrl });
    const tasks: Promise<unknown>[] = [
      sendEmail({
        to: ADMIN_EMAIL,
        subject: `New Signal question from ${v.value.name}`,
        html: adminMail.html,
        text: adminMail.text,
        // Let the team reply straight to the asker when an address was given.
        replyTo: v.value.email ?? undefined,
      }),
    ];

    if (v.value.email) {
      const askerMail = buildAskerConfirmationEmail(emailData);
      tasks.push(
        sendEmail({
          to: v.value.email,
          subject: "We received your question | FF Beacon",
          html: askerMail.html,
          text: askerMail.text,
        }),
      );
    }

    await Promise.allSettled(tasks);
  });

  return NextResponse.json({ ok: true });
}
