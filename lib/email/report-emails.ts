/**
 * Notification fired when a visitor reports that On The Clock detected the wrong
 * league format. It goes to the FF Beacon team so the format-detection mapping can
 * be reviewed and fixed. Reuses the branded light shell in ./layout.
 *
 * The email carries everything needed to reproduce and fix the mismatch: who
 * reported it (name + email), the Sleeper username they searched, the full league
 * identity (name, season, ids, size, status), the league's actual derived format,
 * and the format On The Clock assigned it.
 */

import {
  buildBrandedEmail,
  emailButton,
  emailHeading,
  emailParagraph,
  emailQuoteCard,
} from "./layout";

export type FormatReportEmailData = {
  reporterName: string;
  reporterEmail: string;
  sleeperUsername: string;
  leagueName: string;
  leagueId: string;
  draftId: string;
  season: string;
  totalRosters: number | null;
  draftStatus: string | null;
  /** The format On The Clock assigned (display label), e.g. "Dynasty PPR Superflex". */
  assignedFormatLabel: string;
  /** The assigned format_configs slug, e.g. "dynasty-ppr-sflex". */
  assignedFormatSlug: string | null;
  /** Plain-language format derived from the league's real Sleeper settings. */
  derivedFormatLabel: string | null;
  /** True when a closest-match fallback was used (no exact FF Beacon format). */
  isClosestMatch: boolean;
  /** Optional free-text note from the reporter. */
  details: string | null;
};

/** Notification to the FF Beacon team with a one-click link to the Sleeper league. */
export function buildFormatReportEmail(data: FormatReportEmailData) {
  const teams =
    typeof data.totalRosters === "number" && data.totalRosters > 0
      ? `${data.totalRosters}`
      : "Unknown";
  const assigned = data.assignedFormatSlug
    ? `${data.assignedFormatLabel} (${data.assignedFormatSlug})`
    : data.assignedFormatLabel;

  const rows: Array<{ label: string; value: string }> = [
    { label: "Reporter", value: data.reporterName },
    { label: "Reporter email", value: data.reporterEmail },
    { label: "Sleeper username searched", value: data.sleeperUsername },
    { label: "League", value: `${data.leagueName} (${data.season})` },
    { label: "Sleeper league id", value: data.leagueId },
    { label: "Sleeper draft id", value: data.draftId },
    { label: "Teams", value: teams },
    { label: "League status", value: data.draftStatus ?? "Unknown" },
    {
      label: "League's actual format (derived from Sleeper)",
      value: data.derivedFormatLabel ?? "Unknown",
    },
    { label: "Format we assigned", value: assigned },
    { label: "Closest-match fallback used", value: data.isClosestMatch ? "Yes" : "No" },
  ];
  if (data.details) {
    rows.push({ label: "Reporter note", value: data.details });
  }

  const leagueUrl = `https://sleeper.com/leagues/${data.leagueId}`;

  const inner = `
    ${emailHeading("Reported: incorrect league format")}
    ${emailParagraph(
      "A visitor flagged On The Clock's detected format as wrong for their league. Review the mapping and correct the format assignment if needed.",
    )}
    ${emailQuoteCard(rows)}
    ${emailParagraph("Open the league on Sleeper to check its scoring and roster settings:")}
    ${emailButton("Open league on Sleeper", leagueUrl)}`;

  const text = `Reported: incorrect league format

A visitor flagged On The Clock's detected format as wrong for their league.

Reporter: ${data.reporterName}
Reporter email: ${data.reporterEmail}
Sleeper username searched: ${data.sleeperUsername}
League: ${data.leagueName} (${data.season})
Sleeper league id: ${data.leagueId}
Sleeper draft id: ${data.draftId}
Teams: ${teams}
League status: ${data.draftStatus ?? "Unknown"}
League's actual format (derived from Sleeper): ${data.derivedFormatLabel ?? "Unknown"}
Format we assigned: ${assigned}
Closest-match fallback used: ${data.isClosestMatch ? "Yes" : "No"}${
    data.details ? `\nReporter note: ${data.details}` : ""
  }

Open the league on Sleeper: ${leagueUrl}`;

  return buildBrandedEmail({
    title: "Incorrect league format reported",
    preheader: `${data.reporterName} reported a wrong format on ${data.leagueName}.`,
    innerHtml: inner,
    textBody: text,
  });
}
