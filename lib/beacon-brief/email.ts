/**
 * The Beacon Brief failure alert email.
 *
 * Sent when a queue job exhausts its retry attempts (or a pipeline error needs
 * surfacing). Reuses the shared branded email shell (lib/email/layout) and the
 * Resend sender (lib/email/send), so it matches every other FF Beacon email.
 * Never throws: sendEmail returns a structured result and no-ops if RESEND is
 * unconfigured.
 */

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
}

export async function sendBeaconBriefFailureEmail(
  failure: BeaconBriefFailure,
): Promise<void> {
  const moderationUrl = `${EMAIL_SITE_URL}/admin/beacon-brief/moderation`;

  const innerHtml = [
    emailHeading("A Beacon Brief job failed"),
    emailParagraph(
      "A Beacon Brief queue job hit its maximum retry attempts and was marked failed. Details below. It now waits in the Moderation queue, where you can retry it or skip it.",
    ),
    emailQuoteCard([
      { label: "Job type", value: failure.jobType },
      { label: "Job id", value: failure.jobId },
      { label: "Attempts", value: String(failure.attempts) },
      { label: "Error", value: failure.error.slice(0, 400) },
    ]),
    emailButton("Retry or skip in Moderation", moderationUrl),
  ].join("");

  const textBody = [
    "A Beacon Brief queue job failed after its maximum retry attempts.",
    "",
    `Job type: ${failure.jobType}`,
    `Job id: ${failure.jobId}`,
    `Attempts: ${failure.attempts}`,
    `Error: ${failure.error}`,
    "",
    `Retry or skip: ${moderationUrl}`,
  ].join("\n");

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
