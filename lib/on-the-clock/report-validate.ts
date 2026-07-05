/**
 * Validation for the On The Clock "report incorrect format" intake. Pure and
 * browser-safe (no Supabase / fetch), so both the client dialog and the API route
 * can share the same rules. Returns friendly, screen-reader-appropriate messages.
 *
 * The reporter supplies name + email + an optional note. The rest of the payload
 * is league context the client already holds (username searched, league identity,
 * detected vs assigned format); we validate its shape so a forged request cannot
 * inject oversized or malformed strings into the notification email.
 */

export const REPORT_NAME_MAX = 120;
export const REPORT_EMAIL_MAX = 320;
export const REPORT_DETAILS_MAX = 1000;
export const REPORT_LABEL_MAX = 200;
export const REPORT_SLUG_MAX = 60;

// Pragmatic email shape check (not RFC-perfect): one @, a dot in the domain, no
// spaces. Email is REQUIRED here so we can reply to the reporter.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Sleeper league / draft ids are numeric strings.
const SLEEPER_ID_RE = /^[0-9]{1,32}$/;

export type ValidatedFormatReport = {
  reporterName: string;
  reporterEmail: string;
  sleeperUsername: string;
  leagueName: string;
  leagueId: string;
  draftId: string;
  season: string;
  totalRosters: number | null;
  draftStatus: string | null;
  assignedFormatLabel: string;
  assignedFormatSlug: string | null;
  derivedFormatLabel: string | null;
  isClosestMatch: boolean;
  details: string | null;
};

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function cappedLabel(v: unknown, max: number): string | null {
  const s = str(v);
  if (!s) return null;
  return s.slice(0, max);
}

export function validateFormatReportInput(input: {
  reporterName: unknown;
  reporterEmail: unknown;
  sleeperUsername: unknown;
  leagueName: unknown;
  leagueId: unknown;
  draftId: unknown;
  season: unknown;
  totalRosters: unknown;
  draftStatus: unknown;
  assignedFormatLabel: unknown;
  assignedFormatSlug: unknown;
  derivedFormatLabel: unknown;
  isClosestMatch: unknown;
  details: unknown;
}): Result<ValidatedFormatReport> {
  const reporterName = str(input.reporterName);
  const reporterEmail = str(input.reporterEmail);
  const details = str(input.details);

  if (!reporterName) {
    return { ok: false, error: "Enter your name so we know who is reporting." };
  }
  if (reporterName.length > REPORT_NAME_MAX) {
    return { ok: false, error: `Keep your name under ${REPORT_NAME_MAX} characters.` };
  }
  if (!reporterEmail) {
    return { ok: false, error: "Enter your email so we can follow up." };
  }
  if (reporterEmail.length > REPORT_EMAIL_MAX || !EMAIL_RE.test(reporterEmail)) {
    return { ok: false, error: "That email address does not look right. Please fix it." };
  }
  if (details.length > REPORT_DETAILS_MAX) {
    return { ok: false, error: `Keep your note under ${REPORT_DETAILS_MAX} characters.` };
  }

  const leagueId = str(input.leagueId);
  const draftId = str(input.draftId);
  const season = str(input.season);
  if (!SLEEPER_ID_RE.test(leagueId) || !SLEEPER_ID_RE.test(draftId)) {
    return { ok: false, error: "We could not read this league. Please reopen it and try again." };
  }
  if (!/^[0-9]{4}$/.test(season)) {
    return { ok: false, error: "We could not read this league. Please reopen it and try again." };
  }

  const totalRostersRaw = input.totalRosters;
  let totalRosters: number | null = null;
  if (typeof totalRostersRaw === "number" && Number.isFinite(totalRostersRaw)) {
    totalRosters = Math.max(0, Math.min(64, Math.round(totalRostersRaw)));
  }

  return {
    ok: true,
    value: {
      reporterName: reporterName.slice(0, REPORT_NAME_MAX),
      reporterEmail,
      sleeperUsername: cappedLabel(input.sleeperUsername, REPORT_LABEL_MAX) ?? "Unknown",
      leagueName: cappedLabel(input.leagueName, REPORT_LABEL_MAX) ?? "Unknown league",
      leagueId,
      draftId,
      season,
      totalRosters,
      draftStatus: cappedLabel(input.draftStatus, REPORT_LABEL_MAX),
      assignedFormatLabel: cappedLabel(input.assignedFormatLabel, REPORT_LABEL_MAX) ?? "Unknown",
      assignedFormatSlug: cappedLabel(input.assignedFormatSlug, REPORT_SLUG_MAX),
      derivedFormatLabel: cappedLabel(input.derivedFormatLabel, REPORT_LABEL_MAX),
      isClosestMatch: input.isClosestMatch === true,
      details: details ? details.slice(0, REPORT_DETAILS_MAX) : null,
    },
  };
}
