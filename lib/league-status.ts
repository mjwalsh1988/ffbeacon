/**
 * Single source of truth for turning a raw Sleeper league status
 * (e.g. "in_season", "pre_draft", "post-season") into a display label.
 *
 * Rules:
 * - Underscores AND hyphens collapse to spaces (so "pre-draft" and
 *   "pre_draft" render identically).
 * - Each word is title-cased (first letter capitalized, rest lower).
 * - Empty / nullish input renders as "Unknown" so the UI never shows a
 *   bare empty pill.
 *
 * Used by both /tools/league-sync (LeagueResults) and the league deep
 * view (/leagues/[id]) so any future Sleeper status string gets the
 * same treatment everywhere without per-call-site tweaks.
 */
export function humanizeLeagueStatus(raw: string | null | undefined): string {
  if (!raw) return "Unknown";
  return raw
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}
