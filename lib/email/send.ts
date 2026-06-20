/**
 * Transactional email via the Resend REST API.
 *
 * We call the REST endpoint directly with fetch (no SDK dependency). The API key
 * lives in RESEND_API_KEY (server-only; never exposed to the client). If the key
 * is missing, send() is a graceful no-op that logs a warning and returns
 * { ok: false, skipped: true } so callers (e.g. the community-question submit
 * route) keep working: the submission still queues, the email just is not sent.
 *
 * Sender identity (per product decision):
 *   - From:     FFBeacon.com <signal@ffbeacon.com>   (override via EMAIL_FROM)
 *   - Reply-To: michael@ffbeacon.com                 (override via EMAIL_REPLY_TO)
 * Both addresses must belong to a domain verified in Resend before real delivery
 * works.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export const EMAIL_FROM = process.env.EMAIL_FROM ?? "FFBeacon.com <signal@ffbeacon.com>";
export const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO ?? "michael@ffbeacon.com";

export type SendEmailArgs = {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  /** Defaults to EMAIL_REPLY_TO. Pass null to omit the header entirely. */
  replyTo?: string | null;
};

export type SendEmailResult =
  | { ok: true; id: string | null }
  | { ok: false; skipped: true }
  | { ok: false; skipped: false; error: string };

/**
 * Send one email. Never throws: every failure is returned as a structured result
 * so a delivery problem can't take down the request that triggered it.
 */
export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(
      "[email] RESEND_API_KEY is not set; skipping send to",
      Array.isArray(args.to) ? args.to.join(", ") : args.to,
    );
    return { ok: false, skipped: true };
  }

  const replyTo = args.replyTo === undefined ? EMAIL_REPLY_TO : args.replyTo;

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: Array.isArray(args.to) ? args.to : [args.to],
        subject: args.subject,
        html: args.html,
        text: args.text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
      // Hang guard for a slow/unresponsive provider. Sending runs in after() so
      // this never blocks the user's response; the timeout just caps the worker.
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[email] Resend responded", res.status, detail.slice(0, 500));
      return { ok: false, skipped: false, error: `Resend error ${res.status}` };
    }

    const data = (await res.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, id: data?.id ?? null };
  } catch (err) {
    console.error("[email] send failed", err);
    return { ok: false, skipped: false, error: "send failed" };
  }
}
