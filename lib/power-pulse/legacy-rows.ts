/**
 * Cached Power Pulse rows that must never be served.
 *
 * Before pp-10 a chopped (guillotine) league could be scored as an ordinary
 * head to head league: pp-6 and pp-7 had no chopped model at all, pp-8 added
 * one, and pp-10 fixed the leagues it still missed. Those rows carry playoff
 * odds, title odds and a projected record for a league with no bracket and no
 * record that decides anything. Production on 2026-11-13 still held them for
 * 22 in-season leagues that nobody had opened since.
 *
 * The orchestrator deletes them whenever it runs for a chopped league, and the
 * model version moved past them, so any view rescores the league. A reader
 * that might run before that rescore drops them with this check, so the page
 * shows its "building" state rather than a bracket that does not exist.
 */

/** Sleeper's settings.type for a chopped (guillotine) league. */
const CHOPPED_LEAGUE_TYPE = 3;

/** The first model version whose rows a chopped-type league may be served. */
const FIRST_SERVABLE_CHOPPED_MODEL = 10;

/** "pp-8:sleeper" or "pp-11+abc:sleeper:xyz@k" to 8 or 11. Null when unreadable. */
export function modelVersionNumber(modelVersion: string | null | undefined): number | null {
  const match = /^pp-(\d+)/.exec(modelVersion ?? "");
  return match ? Number(match[1]) : null;
}

/**
 * True for a row a chopped-type league kept from a model that could score it
 * as a bracket league. `leagueType` is Sleeper's settings.type off the league
 * row. A row the chopped model wrote (chopped = true) is always servable.
 */
export function isLegacyBracketRowForChoppedLeague(
  row: { chopped?: boolean | null; model_version?: string | null },
  leagueType: number,
): boolean {
  if (leagueType !== CHOPPED_LEAGUE_TYPE) return false;
  if (row.chopped === true) return false;
  const version = modelVersionNumber(row.model_version);
  return version === null || version < FIRST_SERVABLE_CHOPPED_MODEL;
}
