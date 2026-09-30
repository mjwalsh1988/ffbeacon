/**
 * The immediate alert for one scheduled job that just failed.
 *
 * The daily schedule health email (./cron-health-emails) is a digest: it runs
 * at 16:00 UTC and reports everything it finds, so a value sync that failed at
 * 07:00 was reported nine hours later. This one goes out from inside the failed
 * run itself, so the owner hears about a failure within the minute and can
 * investigate while the data window is still open.
 *
 * Deduplication lives in lib/cron-alerts.ts, not here: this file only renders
 * and sends. Reuses the branded shell and the Resend sender, so it no-ops
 * cleanly when Resend is unconfigured.
 */

import {
  buildBrandedEmail,
  emailButton,
  emailHeading,
  emailParagraph,
  emailQuoteCard,
  EMAIL_SITE_URL,
} from "./layout";
import { sendEmail, type SendEmailResult } from "./send";
import { formatEastern } from "../datetime";
import { CRON_HEALTH_ALERT_TO } from "./cron-health-emails";

export type CronFailureAlert = {
  jobName: string;
  label: string;
  startedAt: string;
  /** The recorded error, or the list of sub-steps that failed. */
  error: string;
  /** True when the run finished but one or more of its steps failed. */
  partial: boolean;
  /** Hours before another alert for the same job can go out. */
  cooldownHours: number;
};

/** Subject line, kept separate so the test can read it without a send. */
export function cronFailureSubject(alert: Pick<CronFailureAlert, "label" | "partial">): string {
  return alert.partial
    ? `FF Beacon: ${alert.label} finished with a failed step`
    : `FF Beacon: ${alert.label} failed`;
}

export async function sendCronFailureEmail(alert: CronFailureAlert): Promise<SendEmailResult> {
  const url = `${EMAIL_SITE_URL}/admin/crons?job=${encodeURIComponent(alert.jobName)}`;
  const when = formatEastern(alert.startedAt);
  const error = alert.error.slice(0, 1500);

  const headline = alert.partial
    ? `${alert.label} finished with a failed step`
    : `${alert.label} failed`;
  const lead = alert.partial
    ? "The run completed, but at least one of its steps did not. The steps that did run were saved; the ones listed below were not, and nothing retries them until the next scheduled run."
    : "The run stopped with an error. Whatever it was meant to write for this run was not written, and nothing retries it until the next scheduled run.";
  const cooldown = `If it keeps failing, the next alert for this job waits ${alert.cooldownHours} hours, and the daily schedule health email still lists it.`;

  const innerHtml = [
    emailHeading(headline),
    emailParagraph(lead),
    emailQuoteCard([
      { label: "Job", value: alert.jobName },
      { label: "Started", value: when },
      { label: alert.partial ? "Failed steps" : "Error", value: error },
    ]),
    emailParagraph(cooldown),
    emailButton("Open the run ledger", url),
  ].join("");

  const textBody = [
    headline,
    "",
    lead,
    "",
    `Job: ${alert.jobName}`,
    `Started: ${when}`,
    `${alert.partial ? "Failed steps" : "Error"}: ${error}`,
    "",
    cooldown,
    "",
    `Run ledger: ${url}`,
  ].join("\n");

  const { html, text } = buildBrandedEmail({
    title: "FF Beacon job failure",
    preheader: `${alert.jobName}: ${error.slice(0, 120)}`,
    innerHtml,
    textBody,
  });

  return sendEmail({
    to: CRON_HEALTH_ALERT_TO,
    subject: cronFailureSubject(alert),
    html,
    text,
  });
}
