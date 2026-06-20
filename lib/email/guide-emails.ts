/**
 * The two emails fired when a visitor submits a community question from the
 * Signal Guide:
 *   1. buildAskerConfirmationEmail  -> to the visitor (only if they gave an email)
 *   2. buildAdminNotificationEmail  -> to the FF Beacon team
 *
 * Both reuse the branded light shell in ./layout.
 */

import { guidePageTitle } from "@/lib/guide/registry";
import {
  EMAIL_DISCORD_URL,
  buildBrandedEmail,
  emailButton,
  emailHeading,
  emailParagraph,
  emailQuoteCard,
} from "./layout";

export type SubmissionEmailData = {
  name: string;
  email: string | null;
  question: string;
  pageKey: string;
};

/** Confirmation to the asker. Only call when data.email is present. */
export function buildAskerConfirmationEmail(data: SubmissionEmailData) {
  const pageTitle = guidePageTitle(data.pageKey);
  const inner = `
    ${emailHeading(`Thanks, ${data.name.split(" ")[0] || data.name}. We got your question.`)}
    ${emailParagraph(
      "Our team will look into it and add a clear answer to the Signal knowledge base. Because you shared your email, we will also reply directly to let you know once it is answered.",
    )}
    ${emailParagraph("Here is a copy of what you sent us, for your records:")}
    ${emailQuoteCard([
      { label: "Your question", value: data.question },
      { label: "Page", value: pageTitle },
    ])}
    ${emailParagraph(
      `Need a hand sooner? Reply to this email or join us on <a href="${EMAIL_DISCORD_URL}" target="_blank" style="color:#7C3AED;font-weight:bold;text-decoration:none;">Discord</a>.`,
    )}`;

  const text = `Thanks, ${data.name}. We got your question.

Our team will look into it and add a clear answer to the Signal knowledge base. Because you shared your email, we will also reply directly to let you know once it is answered.

Here is a copy of what you sent us:

Your question: ${data.question}
Page: ${pageTitle}

Need a hand sooner? Reply to this email or join us on Discord: ${EMAIL_DISCORD_URL}`;

  return buildBrandedEmail({
    title: "We received your question",
    preheader: "We got your question and will add the answer to our Signal knowledge base.",
    innerHtml: inner,
    textBody: text,
  });
}

/** Notification to the FF Beacon team with a one-click review link. */
export function buildAdminNotificationEmail(data: SubmissionEmailData & { reviewUrl: string }) {
  const pageTitle = guidePageTitle(data.pageKey);
  const inner = `
    ${emailHeading("New community question")}
    ${emailParagraph(
      "Someone could not find what they needed in the Signal Guide and submitted a question for review.",
    )}
    ${emailQuoteCard([
      { label: "From", value: data.name },
      { label: "Email", value: data.email ?? "Not provided (no reply expected)" },
      { label: "Page", value: pageTitle },
      { label: "Question", value: data.question },
    ])}
    ${emailParagraph("Open it in the admin queue to answer it or dismiss it:")}
    ${emailButton("Review this question", data.reviewUrl)}`;

  const text = `New community question

Someone could not find what they needed in the Signal Guide and submitted a question for review.

From: ${data.name}
Email: ${data.email ?? "Not provided (no reply expected)"}
Page: ${pageTitle}
Question: ${data.question}

Review it here: ${data.reviewUrl}`;

  return buildBrandedEmail({
    title: "New community question",
    preheader: `${data.name} asked a question on ${pageTitle}.`,
    innerHtml: inner,
    textBody: text,
  });
}
