/**
 * The two emails fired when someone submits "Help BEAM learn this":
 *   1. buildBeamAskerEmail  -> to the visitor (only when they gave an address)
 *   2. buildBeamAdminEmail  -> to the FF Beacon team
 *
 * Both use the branded light shell in ./layout, the same as the Signal Guide
 * question emails. Every interpolated value goes through esc(): the question and
 * the note are free text a stranger typed, and an email is HTML.
 */

import {
  EMAIL_DISCORD_URL,
  buildBrandedEmail,
  emailButton,
  emailHeading,
  emailParagraph,
  emailQuoteCard,
} from "./layout";

export type BeamRequestEmailData = {
  name: string;
  email: string | null;
  question: string;
  message: string | null;
};

/** Confirmation to the asker. Only call when data.email is present. */
export function buildBeamAskerEmail(data: BeamRequestEmailData) {
  const firstName = data.name.split(" ")[0] || data.name;
  const rows = [{ label: "Your question", value: data.question }];
  if (data.message) rows.push({ label: "Your note", value: data.message });

  const inner = `
    ${emailHeading(`Thanks, ${firstName}. BEAM is taking notes.`)}
    ${emailParagraph(
      "BEAM answers questions from FF Beacon's own data, and it learns new question types one at a time. Yours is now in the queue we work from, and the ones people ask most are the ones that get built next.",
    )}
    ${emailParagraph("Here is what you sent, for your records:")}
    ${emailQuoteCard(rows)}
    ${emailParagraph(
      `Want an answer sooner? Real people will happily take a swing at it on <a href="${EMAIL_DISCORD_URL}" target="_blank" style="color:#7C3AED;font-weight:bold;text-decoration:none;">Discord</a>.`,
    )}`;

  const text = `Thanks, ${firstName}. BEAM is taking notes.

BEAM answers questions from FF Beacon's own data, and it learns new question types one at a time. Yours is now in the queue we work from, and the ones people ask most are the ones that get built next.

Here is what you sent:

Your question: ${data.question}${data.message ? `\nYour note: ${data.message}` : ""}

Want an answer sooner? Real people will happily take a swing at it on Discord: ${EMAIL_DISCORD_URL}`;

  return buildBrandedEmail({
    title: "BEAM is taking notes",
    preheader: "We got your question and added it to the list BEAM learns from.",
    innerHtml: inner,
    textBody: text,
  });
}

/** Notification to the team, with a link straight into the admin queue. */
export function buildBeamAdminEmail(data: BeamRequestEmailData & { reviewUrl: string }) {
  const rows = [
    { label: "From", value: data.name },
    { label: "Email", value: data.email ?? "Not provided (no reply expected)" },
    { label: "Question BEAM could not answer", value: data.question },
  ];
  if (data.message) rows.push({ label: "Their note", value: data.message });

  const inner = `
    ${emailHeading("BEAM could not answer this one")}
    ${emailParagraph(
      "Someone hit a question BEAM does not handle yet and asked us to teach it.",
    )}
    ${emailQuoteCard(rows)}
    ${emailParagraph("Open the queue to triage it:")}
    ${emailButton("Review this request", data.reviewUrl)}`;

  const text = `BEAM could not answer this one

Someone hit a question BEAM does not handle yet and asked us to teach it.

From: ${data.name}
Email: ${data.email ?? "Not provided (no reply expected)"}
Question BEAM could not answer: ${data.question}${data.message ? `\nTheir note: ${data.message}` : ""}

Review it here: ${data.reviewUrl}`;

  return buildBrandedEmail({
    title: "New BEAM learning request",
    preheader: `${data.name} asked BEAM something it could not answer.`,
    innerHtml: inner,
    textBody: text,
  });
}
