/**
 * Pure layout arithmetic for the start/sit share image (route.tsx).
 *
 * Split out from the route so the card ordering, badge rule and sizing can be
 * unit tested without importing next/og or touching a database, matching the
 * app/api/og/war/[league_id]/card.tsx precedent. Nothing here reads from
 * Supabase, satori or React: plain data in, plain data out.
 */

import type {
  StartSitCandidate,
  StartSitProjection,
  StartSitVerdict,
  PulsePosition,
} from "@/lib/start-sit/types";

/** One player's card on the share image, already resolved against the verdict. */
export type StartSitOgCard = {
  playerId: string;
  name: string;
  position: PulsePosition;
  team: string | null;
  sleeperId: string | null;
  points: number | null;
  onBye: boolean;
  availability: "projected" | "out" | null;
  isStarter: boolean;
};

/**
 * The ordered card list: starters first, then the bench, each group already
 * in the descending-points order rankForWeek produced (section 2.5, item 2:
 * "Starters come first, then the bench, each group in descending projected
 * points"). A playerId on the verdict with no matching candidate row is
 * skipped rather than crashing the render; that should never happen since
 * the verdict is built from the same candidates list, but a card that cannot
 * be described is safer left off than rendered blank.
 */
export function buildStartSitOgCards(
  verdict: Pick<StartSitVerdict, "starters" | "bench">,
  candidates: StartSitCandidate[],
  projectionsByPlayerId: Map<string, StartSitProjection>,
): StartSitOgCard[] {
  const byId = new Map(candidates.map((c) => [c.playerId, c]));
  const starterSet = new Set(verdict.starters);
  const cards: StartSitOgCard[] = [];

  for (const playerId of [...verdict.starters, ...verdict.bench]) {
    const candidate = byId.get(playerId);
    if (!candidate) continue;
    const projection = projectionsByPlayerId.get(playerId) ?? null;
    cards.push({
      playerId,
      name: candidate.name,
      position: candidate.position,
      team: candidate.team,
      sleeperId: candidate.sleeperId,
      points: projection?.points ?? null,
      onBye: projection?.onBye ?? false,
      availability: projection?.availability ?? null,
      isStarter: starterSet.has(playerId),
    });
  }

  return cards;
}

/** The word printed on a card's badge pill. */
export type StartSitOgBadge = "START" | "SIT" | "BYE" | "OUT";

/**
 * BYE and OUT outrank the plain START/SIT call, because both explain WHY a
 * player sits rather than just asserting that he does; a reader seeing "SIT"
 * next to an obviously-hurt name would reasonably wonder if the tool noticed.
 */
export function cardBadgeLabel(
  card: Pick<StartSitOgCard, "onBye" | "availability" | "isStarter">,
): StartSitOgBadge {
  if (card.onBye) return "BYE";
  if (card.availability === "out") return "OUT";
  return card.isStarter ? "START" : "SIT";
}

/** The row of cards fits inside the card padding: 1200 - 2*44. */
const CARD_ROW_WIDTH = 1112;
/** Gap between adjacent cards, in px. */
export const CARD_GAP = 10;
/** Widest a card ever gets, so two or three players do not stretch into empty space. */
const CARD_MAX_WIDTH = 150;
/** Narrowest a card ever gets, so eight players stay readable. */
const CARD_MIN_WIDTH = 96;

/**
 * Card width in px for a row of `count` cards, evenly divided across the
 * available width and clamped to [CARD_MIN_WIDTH, CARD_MAX_WIDTH]. The row is
 * centered (justifyContent: "center" in the route) rather than stretched, so
 * a two-player board reads as two cards, not two cards pulled apart to fill
 * the width eight would use.
 */
export function cardWidthPx(count: number): number {
  if (count <= 0) return CARD_MAX_WIDTH;
  const available = CARD_ROW_WIDTH - CARD_GAP * (count - 1);
  const width = Math.floor(available / count);
  return Math.max(CARD_MIN_WIDTH, Math.min(CARD_MAX_WIDTH, width));
}

/**
 * Headline font size for the verdict sentence, largest first with a longer
 * sentence shrinking a step at a time so the two-player "Start X. He
 * projects N points clear of Y" case reads big and the crowded
 * five-plus-player "the last spot is close" case still fits.
 */
export function headlineFontSize(text: string): number {
  if (text.length > 110) return 32;
  if (text.length > 70) return 38;
  return 44;
}

/** "71%", or "--" when the two players on the borderline cannot be compared. */
export function formatConfidencePercent(confidence: number | null): string {
  if (confidence === null) return "--";
  return `${Math.round(confidence * 100)}%`;
}
