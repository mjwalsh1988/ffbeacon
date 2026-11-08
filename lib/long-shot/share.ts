/**
 * The plain-text share row (plan 14). Pure and ASCII only.
 *
 *   Long Shot, Nov 7, 2026
 *   C F D S L = 285
 *   ffbeacon.com/games/long-shot
 *
 * One letter per prompt in order (X for a miss or timeout), then the base
 * total; a non-zero settled bonus appends " +15 Lone Signal".
 */

import { formatEasternShortDate } from "@/lib/datetime";
import { MISS_LETTER, TIER_LETTERS, type Tier } from "./types";

export const SHARE_URL = "ffbeacon.com/games/long-shot";

export function shareDateLabel(gameDate: string): string {
  // The game date at UTC noon is the same calendar day in Eastern.
  return `${formatEasternShortDate(`${gameDate}T12:00:00Z`)}, ${gameDate.slice(0, 4)}`;
}

export function tierLetters(tiers: ReadonlyArray<Tier | null>): string[] {
  return tiers.map((t) => (t ? TIER_LETTERS[t] : MISS_LETTER));
}

export function buildShareText(
  tiers: ReadonlyArray<Tier | null>,
  basePoints: number,
  bonusPoints: number,
  gameDate: string,
): string {
  const bonus = bonusPoints > 0 ? ` +${bonusPoints} Lone Signal` : "";
  return [
    `Long Shot, ${shareDateLabel(gameDate)}`,
    `${tierLetters(tiers).join(" ")} = ${basePoints}${bonus}`,
    SHARE_URL,
  ].join("\n");
}
