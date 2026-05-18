/**
 * KTC publishes dynasty draft picks alongside players in the same scraped
 * payload. Pick player_name strings look like:
 *   "2026 Mid 1st"
 *   "2027 Early 2nd"
 *   "2025 Late 3rd"
 *   "2026 Mid 4th"
 * Some variants drop the bucket word ("2026 1st", "2026 1st Round").
 *
 * parsePickName extracts {season, round, pick_position}. Returns null on
 * unrecognized strings so callers can skip cleanly without throwing.
 */

export type ParsedPick = {
  season: number;
  round: number;
  pick_position: "early" | "mid" | "late" | "unknown";
};

const ROUND_BY_ORDINAL: Record<string, number> = {
  "1st": 1,
  "2nd": 2,
  "3rd": 3,
  "4th": 4,
  "5th": 5,
  "6th": 6,
};

export function parsePickName(name: string): ParsedPick | null {
  if (!name) return null;
  const cleaned = name.replace(/\s+/g, " ").trim();

  // Season — first 4-digit year between 2020 and 2099
  const seasonMatch = cleaned.match(/\b(20\d{2})\b/);
  if (!seasonMatch) return null;
  const season = Number(seasonMatch[1]);

  // Round — first ordinal token
  const ordinalMatch = cleaned.toLowerCase().match(/\b(1st|2nd|3rd|4th|5th|6th)\b/);
  if (!ordinalMatch) return null;
  const round = ROUND_BY_ORDINAL[ordinalMatch[1]];
  if (!round) return null;

  // Bucket — Early/Mid/Late, case-insensitive. Default to "mid" since KTC's
  // mid-bucket picks are the most common shape they publish.
  const bucketMatch = cleaned.toLowerCase().match(/\b(early|mid|late)\b/);
  const pick_position: ParsedPick["pick_position"] = bucketMatch
    ? (bucketMatch[1] as ParsedPick["pick_position"])
    : "mid";

  return { season, round, pick_position };
}
