import { createHash } from "node:crypto";
import { NextResponse, after } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getTrustedClientIp } from "@/lib/client-ip";
import { resolveRateLimitActorKey } from "@/lib/rate-limit-actor";
import { validateLearningRequest } from "@/lib/beam/validate";
import { loadBeamSettings } from "@/lib/beam/settings";
import { readLoggedQuestion, scrubQuestion } from "@/lib/beam/log";
import { sendEmail } from "@/lib/email/send";
import { EMAIL_SITE_URL } from "@/lib/email/layout";
import { buildBeamAdminEmail, buildBeamAskerEmail } from "@/lib/email/beam-emails";

/**
 * POST /api/beam/learn
 *
 * "Help BEAM learn this": the exit from a dead end. Modelled directly on
 * /api/guide/submit, which already solved this exact problem for the Signal
 * Guide. Defenses, in order:
 *   1. Full same-origin check (Origin, then Referer, fail closed). Stricter than
 *      the ask endpoint's header check because this one persists a person's name
 *      and sends email.
 *   2. Honeypot: a filled hidden `company` field is a bot. Generic rejection, so
 *      the bot learns nothing about what tripped it.
 *   3. Server-side validation mirroring the migration 0197 CHECK constraints.
 *   4. Durable per-actor rate limit.
 *
 * THE QUESTION IS RE-READ, NOT TRUSTED. When the client sends a queryId, the
 * question text is taken from that logged row rather than from the body. A
 * caller could otherwise file invented text against someone else's query id, and
 * the admin queue would show a pairing that never happened. A submission with no
 * queryId (the log was off, or the row was pruned) falls back to the body text,
 * scrubbed the same way the log scrubs.
 *
 * Email is fired in after(), so a slow provider never adds latency. The row is
 * the source of truth; delivery is best-effort.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_BUCKET = "beam_learn";

const HONEYPOT_MESSAGE =
  "Unable to complete request. Please contact our support team at michael@ffbeacon.com or join our Discord for assistance.";

const ADMIN_EMAIL = process.env.ADMIN_NOTIFICATION_EMAIL ?? "michael@ffbeacon.com";

/**
 * The abuse-triage identifier stored on the row.
 *
 * An UNSALTED sha256 of an IP is reversible: the IPv4 space is 2^32, so a
 * rainbow table over it is minutes of work on a laptop. Storing one next to a
 * person's name and email address is the worst possible place to get that
 * wrong. The rate limiter already derives a salted, non-precomputable actor key
 * (lib/rate-limit-actor.ts), so this reuses it and hashes once more with its own
 * prefix, the same way the ask route separates its log key, so the two ledgers
 * cannot be joined against each other.
 */
function actorFingerprint(actorKey: string): string {
  return createHash("sha256").update(`beam-learn:${actorKey}`).digest("hex");
}

/**
 * The fingerprint the ASK route wrote onto the query row. Recomputed here with
 * the same prefix so a learning request can prove it belongs to the person who
 * asked the question it is attached to.
 */
function askActorFingerprint(actorKey: string): string {
  return createHash("sha256").update(`beam-log:${actorKey}`).digest("hex");
}

/** A name, an optional email, and a note fit in well under this. */
const MAX_BODY_BYTES = 8 * 1024;

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
  // Some browsers omit Origin on same-origin POSTs; fall back to Referer.
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).host === selfHost;
    } catch {
      return false;
    }
  }
  // Neither header present. A real browser sends at least one, and this endpoint
  // sends email, so it fails closed.
  return false;
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ ok: false, error: "Request blocked." }, { status: 403 });
  }

  // Size before parse, for the same reason as the ask route: a route handler
  // has no built-in body cap.
  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "That request is too large." }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const raw = (body ?? {}) as Record<string, unknown>;

  if (typeof raw.company === "string" && raw.company.trim().length > 0) {
    return NextResponse.json({ ok: false, error: HONEYPOT_MESSAGE }, { status: 400 });
  }

  const validated = validateLearningRequest({
    queryId: raw.queryId,
    question: raw.question,
    name: raw.name,
    email: raw.email,
    message: raw.message,
  });
  if (!validated.ok) {
    return NextResponse.json({ ok: false, error: validated.error }, { status: 400 });
  }

  const admin = createAdminClient();
  const settings = await loadBeamSettings(admin);

  const actorKey = await resolveRateLimitActorKey(req);
  const allowed = await claimSlot(
    admin,
    actorKey,
    settings.limits.learnMaxPerWindow,
    settings.limits.learnWindowSeconds,
  );
  if (!allowed) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "You have sent a few of these in a short time. Please wait a few minutes and try again.",
      },
      { status: 429 },
    );
  }

  // Who is submitting. Provenance for the row, and the ownership proof for the
  // query lookup below. Never trusted for authorization.
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

  // Prefer the question we logged over the question the client claims, but only
  // when the caller is the one who asked it.
  //
  // Reading by id alone would be a small oracle: hold a query id, name any email
  // address, and that question's text is delivered there by the confirmation
  // mail. The id is a v4 uuid returned only to the client that asked, so this is
  // defense in depth rather than a live hole. A mismatch is not an error; it
  // simply falls back to the body text, which is the same path a submission with
  // no query id already takes.
  let question = scrubQuestion(validated.value.question);
  let queryId: string | null = null;
  if (validated.value.queryId) {
    const logged = await readLoggedQuestion(admin, validated.value.queryId, {
      actorHash: askActorFingerprint(actorKey),
      userId: submittedUserId,
    });
    if (logged) {
      question = logged.question;
      queryId = logged.id;
    }
  }
  if (!question) {
    return NextResponse.json(
      { ok: false, error: "We could not tell which question this was about." },
      { status: 400 },
    );
  }

  const { data: inserted, error } = await admin
    .from("beam_learning_requests")
    .insert({
      query_id: queryId,
      question,
      name: validated.value.name,
      email: validated.value.email,
      message: validated.value.message,
      ip_hash: actorFingerprint(actorKey),
      submitted_user_id: submittedUserId,
    })
    .select("id")
    .single();

  if (error || !inserted) {
    console.error("[beam/learn] insert failed", error);
    return NextResponse.json(
      { ok: false, error: "Something went wrong saving that. Please try again." },
      { status: 500 },
    );
  }

  const emailData = {
    name: validated.value.name,
    email: validated.value.email,
    question,
    message: validated.value.message,
  };
  const reviewUrl = `${EMAIL_SITE_URL}/admin/beam/requests?request=${inserted.id}`;

  after(async () => {
    const adminMail = buildBeamAdminEmail({ ...emailData, reviewUrl });
    const tasks: Promise<unknown>[] = [
      sendEmail({
        to: ADMIN_EMAIL,
        subject: `BEAM could not answer: ${question.slice(0, 60)}`,
        html: adminMail.html,
        text: adminMail.text,
        replyTo: validated.value.email ?? undefined,
      }),
    ];
    if (validated.value.email) {
      const askerMail = buildBeamAskerEmail(emailData);
      tasks.push(
        sendEmail({
          to: validated.value.email,
          subject: "BEAM is taking notes | FF Beacon",
          html: askerMail.html,
          text: askerMail.text,
        }),
      );
    }
    await Promise.allSettled(tasks);
  });

  return NextResponse.json({ ok: true });
}

async function claimSlot(
  admin: ReturnType<typeof createAdminClient>,
  actorKey: string,
  max: number,
  windowSeconds: number,
): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc("try_claim_rate_limit" as never, {
      p_bucket: RATE_BUCKET,
      p_key: actorKey,
      p_max_requests: max,
      p_window_seconds: windowSeconds,
    } as never);
    if (error) throw new Error(error.message);
    return Boolean(data);
  } catch (err) {
    console.error("[beam/learn] rate-limit check failed", err);
    return false;
  }
}
