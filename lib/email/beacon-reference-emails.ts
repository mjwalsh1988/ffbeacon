/**
 * Alert email for the FF Beacon calibration reference.
 *
 * Fires when the nightly drift preview finds that rebuilding the stored
 * reference would move the board more than the configured thresholds allow, or
 * that the active reference is too old or too thin. It reports; it never acts.
 * A drift spike is more often a source behaving oddly than a stale reference, so
 * the right response is a human looking, not an automatic rebuild.
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

export const BEACON_REFERENCE_ALERT_TO =
  process.env.BEACON_REFERENCE_ALERT_TO ??
  process.env.BEACON_BRIEF_ALERT_TO ??
  "michael@ffbeacon.com";

export interface ReferenceDriftAlert {
  formatSlug: string;
  alerts: string[];
  activeVersion?: number;
  ageDays?: number;
  meanAbs?: number;
  maxMove?: number;
  over250?: number;
  over500?: number;
  spearman?: number;
  players?: number;
}

/** One email covering every format that tripped a threshold on this check. */
export async function sendReferenceDriftEmail(
  formats: ReferenceDriftAlert[],
): Promise<void> {
  if (formats.length === 0) return;
  const url = `${EMAIL_SITE_URL}/admin/beacon/calibration`;

  const rows = formats.flatMap((f) => {
    const out: Array<{ label: string; value: string }> = [
      { label: `${f.formatSlug}: what tripped`, value: f.alerts.join(" ") },
    ];
    if (typeof f.activeVersion === "number") {
      out.push({
        label: `${f.formatSlug}: active reference`,
        value: `version ${f.activeVersion}${typeof f.ageDays === "number" ? `, ${f.ageDays.toFixed(1)} days old` : ""}`,
      });
    }
    if (typeof f.meanAbs === "number") {
      out.push({
        label: `${f.formatSlug}: a rebuild would move`,
        value: `${f.meanAbs.toFixed(0)} points on average, ${f.maxMove?.toFixed(0) ?? "?"} at most, ${f.over250 ?? 0} players by 250+, ${f.over500 ?? 0} by 500+, order correlation ${f.spearman?.toFixed(4) ?? "?"}`,
      });
    }
    return out;
  });

  const innerHtml = [
    emailHeading("A value calibration reference needs a look"),
    emailParagraph(
      `The nightly drift check compared the stored calibration reference against a freshly built one and found ${formats.length === 1 ? "one format" : `${formats.length} formats`} outside the configured limits. Nothing has been changed: the candidate reference was built in memory and discarded, and the live board is still running on the stored reference.`,
    ),
    emailParagraph(
      "A drift spike usually means a source moved a lot or published an unusual list, not that the reference has gone bad. Check the source syncs first, then decide whether to rebuild.",
    ),
    emailQuoteCard(rows),
    emailButton("Open the calibration page", url),
  ].join("");

  const textBody = [
    "The nightly FF Beacon calibration drift check found formats outside the configured limits.",
    "Nothing was changed: the candidate reference was built in memory and discarded.",
    "",
    ...formats.map((f) =>
      [
        `Format: ${f.formatSlug}`,
        `  Tripped: ${f.alerts.join(" ")}`,
        typeof f.activeVersion === "number"
          ? `  Active reference: version ${f.activeVersion}${typeof f.ageDays === "number" ? `, ${f.ageDays.toFixed(1)} days old` : ""}`
          : "",
        typeof f.meanAbs === "number"
          ? `  A rebuild would move: ${f.meanAbs.toFixed(0)} avg, ${f.maxMove?.toFixed(0) ?? "?"} max, ${f.over250 ?? 0} at 250+, ${f.over500 ?? 0} at 500+, rho ${f.spearman?.toFixed(4) ?? "?"}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
    "",
    `Calibration page: ${url}`,
  ].join("\n");

  const { html, text } = buildBrandedEmail({
    title: "FF Beacon calibration drift",
    preheader: `${formats.length === 1 ? formats[0].formatSlug : `${formats.length} formats`} outside the drift limits.`,
    innerHtml,
    textBody,
  });

  await sendEmail({
    to: BEACON_REFERENCE_ALERT_TO,
    subject: "FF Beacon: calibration reference drift",
    html,
    text,
  });
}
