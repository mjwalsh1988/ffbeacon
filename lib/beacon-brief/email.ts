/**
 * The Beacon Brief alert emails.
 *
 * Three kinds: a queue job exhausted its retries, an upstream integration went
 * down, and that integration came back. Each reuses the shared branded shell
 * (lib/email/layout) and the Resend sender (lib/email/send), so they match every
 * other FF Beacon email. Never throws: sendEmail returns a structured result and
 * no-ops if RESEND is unconfigured.
 *
 * Throttling is NOT decided here. lib/beacon-brief/health.ts owns the cooldown
 * and only calls these when an email should actually go out; these functions
 * just render what they are given, including how many alerts the cooldown
 * swallowed since the last one.
 */

import { formatEastern } from "@/lib/datetime";
import {
  buildBrandedEmail,
  emailButton,
  emailHeading,
  emailParagraph,
  emailQuoteCard,
  EMAIL_SITE_URL,
} from "@/lib/email/layout";
import { sendEmail } from "@/lib/email/send";

export const BEACON_BRIEF_ALERT_TO =
  process.env.BEACON_BRIEF_ALERT_TO ?? "michael@ffbeacon.com";

export interface BeaconBriefFailure {
  jobType: string;
  jobId: string;
  attempts: number;
  error: string;
  /** Other jobs that failed during the cooldown and did not get their own email. */
  suppressedSince?: number;
}

export async function sendBeaconBriefFailureEmail(
  failure: BeaconBriefFailure,
): Promise<void> {
  const moderationUrl = `${EMAIL_SITE_URL}/admin/beacon-brief/moderation`;
  const suppressed = failure.suppressedSince ?? 0;
  const alsoLine =
    suppressed > 0
      ? ` ${suppressed} other job${
          suppressed === 1 ? "" : "s"
        } failed since the last alert and are waiting there too.`
      : "";

  const rows = [
    { label: "Job type", value: failure.jobType },
    { label: "Job id", value: failure.jobId },
    { label: "Attempts", value: String(failure.attempts) },
    { label: "Error", value: failure.error.slice(0, 400) },
  ];
  if (suppressed > 0) {
    rows.push({
      label: "Other failures since last alert",
      value: String(suppressed),
    });
  }

  const innerHtml = [
    emailHeading("A Beacon Brief job failed"),
    emailParagraph(
      `A Beacon Brief queue job hit its maximum retry attempts and was marked failed. Details below. It now waits in the Moderation queue, where you can retry it or skip it.${alsoLine}`,
    ),
    emailQuoteCard(rows),
    emailButton("Retry or skip in Moderation", moderationUrl),
  ].join("");

  const textBody = [
    "A Beacon Brief queue job failed after its maximum retry attempts.",
    "",
    `Job type: ${failure.jobType}`,
    `Job id: ${failure.jobId}`,
    `Attempts: ${failure.attempts}`,
    `Error: ${failure.error}`,
    suppressed > 0 ? `Other failures since last alert: ${suppressed}` : "",
    "",
    `Retry or skip: ${moderationUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  const { html, text } = buildBrandedEmail({
    title: "Beacon Brief job failed",
    preheader: `A ${failure.jobType} job failed after ${failure.attempts} attempts.`,
    innerHtml,
    textBody,
  });

  await sendEmail({
    to: BEACON_BRIEF_ALERT_TO,
    subject: "Beacon Brief: a job failed",
    html,
    text,
  });
}

export interface BeaconBriefVolumeCap {
  playerName: string;
  /** Articles that player already had inside the 24-hour window. */
  count: number;
  cap: number;
  /** Posts capped during the cooldown that did not get their own email. */
  suppressedSince?: number;
}

/**
 * The per-player daily article cap tripped.
 *
 * This is the alert that would have turned the 2026-08 duplicate incident into an
 * email on day one instead of a four-day, twenty-three-article backlog. It says what
 * was held and where to release it, and it goes out once per cooldown window however
 * many posts the cap catches.
 */
export async function sendBeaconBriefVolumeCapEmail(
  cap: BeaconBriefVolumeCap,
): Promise<void> {
  const filteredUrl = `${EMAIL_SITE_URL}/admin/beacon-brief/filtered`;
  const suppressed = cap.suppressedSince ?? 0;
  const alsoLine =
    suppressed > 0
      ? ` ${suppressed} other post${
          suppressed === 1 ? " was" : "s were"
        } held since the last alert and are waiting there too.`
      : "";

  const rows = [
    { label: "Player", value: cap.playerName },
    { label: "Articles in the last 24 hours", value: String(cap.count) },
    { label: "Daily cap", value: String(cap.cap) },
  ];
  if (suppressed > 0) {
    rows.push({ label: "Other posts held since last alert", value: String(suppressed) });
  }

  const innerHtml = [
    emailHeading("The Beacon Brief held an article back"),
    emailParagraph(
      `A post about ${cap.playerName} would have been that player's article number ${
        cap.count + 1
      } in 24 hours, past the cap of ${cap.cap}, so it was not written. The Discord card went out as normal and nothing was deleted. The post is waiting in the Filtered queue, where one click publishes it anyway.${alsoLine}`,
    ),
    emailParagraph(
      "A cap that fires usually means a story is arriving in many separate posts and the duplicate matcher is not folding them together. Worth a look at the Logs page if it keeps happening.",
    ),
    emailQuoteCard(rows),
    emailButton("Review in the Filtered queue", filteredUrl),
  ].join("");

  const textBody = [
    `The Beacon Brief held back an article about ${cap.playerName}.`,
    "",
    `Articles in the last 24 hours: ${cap.count}`,
    `Daily cap: ${cap.cap}`,
    suppressed > 0 ? `Other posts held since last alert: ${suppressed}` : "",
    "",
    "The Discord card was posted as normal. Nothing was deleted.",
    "",
    `Review or publish anyway: ${filteredUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  const { html, text } = buildBrandedEmail({
    title: "Beacon Brief held an article back",
    preheader: `${cap.playerName} hit the daily article cap of ${cap.cap}.`,
    innerHtml,
    textBody,
  });

  await sendEmail({
    to: BEACON_BRIEF_ALERT_TO,
    subject: `Beacon Brief: daily article cap reached for ${cap.playerName}`,
    html,
    text,
  });
}

/**
 * Plain-language cause and next step per classified failure kind, so the alert
 * says what to do rather than only what broke. The credits case is the one that
 * actually happened: HTTP 402 with no explanation anywhere in the logs.
 */
const OUTAGE_GUIDANCE: Record<string, { cause: string; action: string }> = {
  credits: {
    cause:
      "The X developer account has no API credits left, so X is refusing every request.",
    action:
      "Top up the balance at console.x.com under Billing, and turn on auto-refill so it cannot run dry again. Nothing needs restarting: the pipeline probes X on its own and resumes within minutes of the balance returning.",
  },
  auth: {
    cause:
      "X rejected the credentials. The bearer token is missing, expired, revoked, or lacks access to this endpoint.",
    action:
      "Regenerate the bearer token at console.x.com and update X_BEARER_TOKEN in the Vercel environment, then redeploy.",
  },
  rate_limit: {
    cause:
      "X is throttling the app for making too many requests in the current window.",
    action:
      "This clears on its own. If it keeps recurring, lower the polling frequency or the deletion sweep batch ceiling on the Beacon Brief settings page.",
  },
  transient: {
    cause:
      "X has been unreachable or returning errors for a sustained stretch. This is usually an outage on their side.",
    action:
      "No action needed yet. The pipeline keeps probing and will resume by itself. If it persists for hours, check status.x.com.",
  },
};

export interface BeaconBriefOutage {
  /** Human-facing component name, e.g. "X (Twitter) API". */
  component: string;
  kind: string;
  httpStatus: number | null;
  detail: string;
  failingSince: string | null;
  consecutiveFailures: number;
  /** Failures the cooldown swallowed since the previous alert. */
  suppressedSince: number;
  /** False on the first alert of an incident, true on a repeat within one outage. */
  alreadyDown: boolean;
}

/**
 * One email when an upstream integration goes down, then silence until the
 * cooldown elapses. Replaces the previous behaviour of one email per failed job,
 * which turned a single billing event into 30 identical alerts.
 */
export async function sendBeaconBriefOutageEmail(
  outage: BeaconBriefOutage,
): Promise<void> {
  const guidance = OUTAGE_GUIDANCE[outage.kind] ?? OUTAGE_GUIDANCE.transient;
  const settingsUrl = `${EMAIL_SITE_URL}/admin/beacon-brief/settings`;
  const headline = outage.alreadyDown
    ? `${outage.component} is still down`
    : `${outage.component} is down`;

  const rows = [
    { label: "What happened", value: guidance.cause },
    { label: "What to do", value: guidance.action },
    {
      label: "Reported by X",
      value: outage.httpStatus
        ? `${outage.detail}`
        : outage.detail || "no detail",
    },
    { label: "Failing since", value: formatEastern(outage.failingSince) },
    {
      label: "Failed calls",
      value: String(outage.consecutiveFailures),
    },
  ];
  if (outage.suppressedSince > 0) {
    rows.push({
      label: "Alerts held back",
      value: `${outage.suppressedSince} since the last email`,
    });
  }

  const innerHtml = [
    emailHeading(headline),
    emailParagraph(
      "The Beacon Brief has paused its calls to this service and is checking every few minutes for it to come back. No new articles will publish until it does, and nothing already published is affected.",
    ),
    emailQuoteCard(rows),
    emailButton("Beacon Brief settings", settingsUrl),
  ].join("");

  const textBody = [
    `${headline}.`,
    "",
    "The Beacon Brief has paused its calls to this service and is checking every few minutes for it to come back. No new articles will publish until it does, and nothing already published is affected.",
    "",
    `What happened: ${guidance.cause}`,
    `What to do: ${guidance.action}`,
    `Reported by X: ${outage.detail}`,
    `Failing since: ${formatEastern(outage.failingSince)}`,
    `Failed calls: ${outage.consecutiveFailures}`,
    outage.suppressedSince > 0
      ? `Alerts held back: ${outage.suppressedSince} since the last email`
      : "",
    "",
    `Settings: ${settingsUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  const { html, text } = buildBrandedEmail({
    title: headline,
    preheader: guidance.cause,
    innerHtml,
    textBody,
  });

  await sendEmail({
    to: BEACON_BRIEF_ALERT_TO,
    subject: `Beacon Brief: ${outage.component} is down (${outage.kind})`,
    html,
    text,
  });
}

export interface BeaconBriefRecovery {
  component: string;
  downSince: string | null;
  recoveredAt: string;
}

/** One email when the integration answers again, so the incident visibly closes. */
export async function sendBeaconBriefRecoveryEmail(
  recovery: BeaconBriefRecovery,
): Promise<void> {
  const headline = `${recovery.component} is back`;
  const rows = [
    { label: "Down since", value: formatEastern(recovery.downSince) },
    { label: "Recovered", value: formatEastern(recovery.recoveredAt) },
  ];

  const innerHtml = [
    emailHeading(headline),
    emailParagraph(
      "A recovery probe succeeded, so the Beacon Brief has resumed normal polling. Posts published while the service was down are still queued and will be worked through on the next few runs.",
    ),
    emailQuoteCard(rows),
    emailButton("Open the Brief", `${EMAIL_SITE_URL}/brief`),
  ].join("");

  const textBody = [
    `${headline}.`,
    "",
    "A recovery probe succeeded, so the Beacon Brief has resumed normal polling. Posts published while the service was down are still queued and will be worked through on the next few runs.",
    "",
    `Down since: ${formatEastern(recovery.downSince)}`,
    `Recovered: ${formatEastern(recovery.recoveredAt)}`,
  ].join("\n");

  const { html, text } = buildBrandedEmail({
    title: headline,
    preheader: `Normal polling resumed at ${formatEastern(recovery.recoveredAt)}.`,
    innerHtml,
    textBody,
  });

  await sendEmail({
    to: BEACON_BRIEF_ALERT_TO,
    subject: `Beacon Brief: ${recovery.component} is back`,
    html,
    text,
  });
}

/** One reference (player/team) name that did not confidently auto-match. */
export interface BeaconBriefMatchReview {
  kind: "player" | "team";
  rawName: string;
  candidateCount: number;
}

/**
 * One batched digest per curation run listing the player/team references that
 * could not be confidently matched (and so were NOT auto-linked). Links to the
 * Moderation page where the admin resolves each in one click. Reuses the same
 * branded shell as the failure alert. No-ops if there is nothing to review.
 */
export async function sendBeaconBriefMatchDigestEmail(input: {
  reviews: BeaconBriefMatchReview[];
}): Promise<void> {
  const { reviews } = input;
  if (reviews.length === 0) return;

  const moderationUrl = `${EMAIL_SITE_URL}/admin/beacon-brief/moderation`;
  const shown = reviews.slice(0, 25);
  const overflow = reviews.length - shown.length;
  const overflowNote = overflow > 0 ? ` and ${overflow} more` : "";
  const plural = reviews.length === 1 ? "" : "s";

  const rows = shown.map((r) => ({
    label: r.kind === "player" ? "Player" : "Team",
    value: `${r.rawName} (${r.candidateCount} suggestion${
      r.candidateCount === 1 ? "" : "s"
    })`,
  }));

  const innerHtml = [
    emailHeading("Beacon Brief: references need your review"),
    emailParagraph(
      `This curation run could not confidently match ${reviews.length} player or team reference${plural}${overflowNote}. They were NOT auto-linked to any profile. Open the Moderation page to pick the correct player or team (or dismiss) so the news shows on the right profile.`,
    ),
    emailQuoteCard(rows),
    emailButton("Resolve in Moderation", moderationUrl),
  ].join("");

  const textBody = [
    `Beacon Brief: ${reviews.length} reference${plural} need manual review.`,
    "",
    ...shown.map(
      (r) => `- ${r.kind}: ${r.rawName} (${r.candidateCount} suggestions)`,
    ),
    overflow > 0 ? `...${overflow} more` : "",
    "",
    `Resolve: ${moderationUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  const { html, text } = buildBrandedEmail({
    title: "Beacon Brief references need review",
    preheader: `${reviews.length} player/team reference${plural} need manual matching.`,
    innerHtml,
    textBody,
  });

  await sendEmail({
    to: BEACON_BRIEF_ALERT_TO,
    subject: `Beacon Brief: ${reviews.length} reference${plural} need review`,
    html,
    text,
  });
}
