/**
 * Alert email for a scheduled job that did not run.
 *
 * The failure this covers leaves no trace anywhere else. cron_runs holds a row
 * per invocation that STARTED, so a job the platform never fired writes nothing:
 * no row, no error, no failed status. The admin health panel shows its previous
 * run and looks fine. On 2026-08-14 that is exactly what happened to
 * sync-dynastyprocess and recalculate-beacon, and the first anyone knew of it
 * was a missing day in the value series found weeks later.
 *
 * So this email is the only signal for its class of problem, which is why it
 * sends on the first miss rather than waiting for a pattern the way the
 * calibration drift alert now does. A missed nightly recompute is already a
 * missing day of data by the time anyone could see it twice.
 *
 * Reuses the branded shell in ./layout and the Resend sender in ./send, so it
 * matches every other FF Beacon email and no-ops cleanly when Resend is
 * unconfigured.
 */

import {
  buildBrandedEmail,
  emailButton,
  emailHeading,
  emailParagraph,
  emailQuoteCard,
  EMAIL_SITE_URL,
} from "./layout";
import { sendEmail } from "./send";
import type { CronMiss } from "../cron-health";
import type { FreshnessResult } from "../data-freshness";

export const CRON_HEALTH_ALERT_TO =
  process.env.CRON_HEALTH_ALERT_TO ??
  process.env.BEACON_REFERENCE_ALERT_TO ??
  process.env.BEACON_BRIEF_ALERT_TO ??
  "michael@ffbeacon.com";

function describeGap(miss: CronMiss): string {
  if (miss.hoursSince === null) return "has never run";
  if (miss.hoursSince < 48) return `last ran ${miss.hoursSince.toFixed(1)} hours ago`;
  return `last ran ${(miss.hoursSince / 24).toFixed(1)} days ago`;
}

function describeStaleness(result: FreshnessResult): string {
  if (result.ageHours === null) return "has no rows at all";
  if (result.ageHours < 48) return `was last written ${result.ageHours.toFixed(1)} hours ago`;
  return `was last written ${(result.ageHours / 24).toFixed(1)} days ago`;
}

/**
 * One email covering every job that is overdue, every run left in flight, and
 * every table that has stopped moving.
 *
 * Stale tables belong in the same email as missed jobs because they are the same
 * failure seen from the other end, and the table view catches a case the job
 * view structurally cannot: a table nothing is scheduled to write. The player
 * dimension went from 2026-05-18 to 2026-08-25 without an update and no job was
 * ever late, because no job existed.
 */
export async function sendCronHealthEmail(args: {
  missed: CronMiss[];
  stalled: Array<{ name: string; startedAt: string }>;
  stale?: FreshnessResult[];
}): Promise<void> {
  const { missed, stalled } = args;
  const stale = args.stale ?? [];
  if (missed.length === 0 && stalled.length === 0 && stale.length === 0) return;
  const url = `${EMAIL_SITE_URL}/admin/crons`;

  const rows: Array<{ label: string; value: string }> = [
    ...missed.map((m) => ({
      label: `${m.label} did not run`,
      value: `${describeGap(m)}, against a ${m.maxGapHours}-hour limit. Schedule ${m.schedule}.`,
    })),
    ...stalled.map((s) => ({
      label: `${s.name} never finished`,
      value: `Still marked running since ${s.startedAt}. The invocation started and died before it could report a result.`,
    })),
    ...stale.map((r) => ({
      label: `${r.label} has gone stale`,
      value: `${r.table} ${describeStaleness(r)}, against a ${r.maxAgeHours}-hour limit. ${r.matters}`,
    })),
  ];

  const headline =
    missed.length > 0
      ? `${missed.length === 1 ? "A scheduled job" : `${missed.length} scheduled jobs`} did not run`
      : stalled.length > 0
        ? "A scheduled job never finished"
        : `${stale.length === 1 ? "A table has" : `${stale.length} tables have`} stopped updating`;

  const innerHtml = [
    emailHeading(headline),
    emailParagraph(
      missed.length > 0
        ? "Nothing failed. These jobs were never invoked at all, which is why nothing else on the site can tell you about it: the run ledger only records invocations that started, so a job the platform skips leaves no row, no error, and a health panel that still shows its previous success."
        : "A run started and then died before it could record a result. The row is still marked running.",
    ),
    emailParagraph(
      "Worth checking whichever data the job produces before assuming the next run will catch up. A missed value sync means a gap in the history, and the derived recalc that follows it will have run off yesterday's board without complaint.",
    ),
    emailQuoteCard(rows),
    emailButton("Open the cron panel", url),
  ].join("");

  const textBody = [
    headline,
    "",
    "The run ledger only records invocations that started, so a skipped job",
    "leaves no row and no error, and a table nothing is scheduled to write is",
    "never reported late at all.",
    "",
    ...missed.map((m) =>
      `${m.name}: ${describeGap(m)}, against a ${m.maxGapHours}-hour limit (schedule ${m.schedule}).`,
    ),
    ...stalled.map((s) => `${s.name}: still marked running since ${s.startedAt}.`),
    ...stale.map(
      (r) => `${r.table}: ${describeStaleness(r)}, against a ${r.maxAgeHours}-hour limit.`,
    ),
    "",
    `Cron panel: ${url}`,
  ].join("\n");

  const { html, text } = buildBrandedEmail({
    title: "FF Beacon schedule health",
    preheader:
      missed.length > 0
        ? `${missed.map((m) => m.name).join(", ")} did not run.`
        : stalled.length > 0
          ? `${stalled.map((s) => s.name).join(", ")} never finished.`
          : `${stale.map((r) => r.table).join(", ")} stopped updating.`,
    innerHtml,
    textBody,
  });

  await sendEmail({
    to: CRON_HEALTH_ALERT_TO,
    subject:
      missed.length > 0 || stalled.length > 0
        ? "FF Beacon: a scheduled job did not run"
        : "FF Beacon: a table has stopped updating",
    html,
    text,
  });
}
