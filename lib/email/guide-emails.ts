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

/**
 * The pages whose form is a contact form rather than a Signal Guide question.
 * They share the intake (components/contact-panel.tsx), but what arrives is a
 * bug report, a privacy request or a hello, and telling that sender their
 * "question" will be answered in a public knowledge base is wrong on every
 * count. These keys get the message wording below.
 */
const CONTACT_PAGE_KEYS: ReadonlySet<string> = new Set(["contact", "about", "author"]);

/** True when a submission from this page is a message, not a guide question. */
export function isContactMessage(pageKey: string): boolean {
  return CONTACT_PAGE_KEYS.has(pageKey);
}

/** Confirmation to someone who wrote through a contact form. */
function buildMessageConfirmationEmail(data: SubmissionEmailData) {
  const pageTitle = guidePageTitle(data.pageKey);
  const firstName = data.name.split(" ")[0] || data.name;
  const promise =
    "Michael builds the site and reads this inbox himself. Because you left your email, the reply comes to this address.";
  const inner = `
    ${emailHeading(`Thanks, ${firstName}. We got your message.`)}
    ${emailParagraph(promise)}
    ${emailParagraph("Here is a copy of what you sent us, for your records:")}
    ${emailQuoteCard([
      { label: "Your message", value: data.question },
      { label: "Sent from", value: pageTitle },
    ])}
    ${emailParagraph(
      `Have something to add? Reply to this email. For a lineup or trade question, the fastest answer is on <a href="${EMAIL_DISCORD_URL}" target="_blank" style="color:#7C3AED;font-weight:bold;text-decoration:none;">Discord</a>.`,
    )}`;

  const text = `Thanks, ${data.name}. We got your message.

${promise}

Here is a copy of what you sent us:

Your message: ${data.question}
Sent from: ${pageTitle}

Have something to add? Reply to this email. For a lineup or trade question, the fastest answer is on Discord: ${EMAIL_DISCORD_URL}`;

  return buildBrandedEmail({
    title: "We received your message",
    preheader: "We got your message, and a person will read it.",
    innerHtml: inner,
    textBody: text,
  });
}

/** Confirmation to the asker. Only call when data.email is present. */
export function buildAskerConfirmationEmail(data: SubmissionEmailData) {
  if (isContactMessage(data.pageKey)) return buildMessageConfirmationEmail(data);
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
  const message = isContactMessage(data.pageKey);
  const heading = message ? "New contact message" : "New community question";
  const lead = message
    ? `Someone wrote through the contact form on the ${pageTitle} page.`
    : "Someone could not find what they needed in the Signal Guide and submitted a question for review.";
  const bodyLabel = message ? "Message" : "Question";
  const inner = `
    ${emailHeading(heading)}
    ${emailParagraph(lead)}
    ${emailQuoteCard([
      { label: "From", value: data.name },
      { label: "Email", value: data.email ?? "Not provided (no reply expected)" },
      { label: "Page", value: pageTitle },
      { label: bodyLabel, value: data.question },
    ])}
    ${emailParagraph("Open it in the admin queue to answer it or dismiss it:")}
    ${emailButton(message ? "Review this message" : "Review this question", data.reviewUrl)}`;

  const text = `${heading}

${lead}

From: ${data.name}
Email: ${data.email ?? "Not provided (no reply expected)"}
Page: ${pageTitle}
${bodyLabel}: ${data.question}

Review it here: ${data.reviewUrl}`;

  return buildBrandedEmail({
    title: heading,
    preheader: message
      ? `${data.name} sent a message from ${pageTitle}.`
      : `${data.name} asked a question on ${pageTitle}.`,
    innerHtml: inner,
    textBody: text,
  });
}
