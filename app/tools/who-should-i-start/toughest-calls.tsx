/**
 * "This week's toughest start/sit calls": the server-rendered grid under the
 * H2 of the same name (docs/seo/who-should-i-start-and-site-seo-plan.md
 * section 2.4's "H2 'This week's toughest start/sit calls'" bullet and
 * section 2.8 in full), plus the "Closest calls at {position} this week"
 * lists that repeat three of the same pairs under each positional heading.
 *
 * Everything here renders a ToughestCallsResult the caller already computed
 * (loadStartSitToughestCallsCached in lib/start-sit/toughest-calls.ts). No
 * model, no fetch, no client hooks: this file is presentation only, and the
 * verdict sentence on every card is computeStartSit's own verdictLine, the
 * same one the board prints, never re-derived here.
 *
 * WHY EVERY CARD ALREADY SHOWS THE ANSWER. Section 2.4 calls this "a
 * server-rendered grid of eight to twelve real comparisons for the live
 * week, verdict already computed and visible in the HTML". The H3 keeps the
 * searcher's own question form ("X or Y?"); the verdict sentence, the two
 * sides with their START and SIT badges, and the points answer it in the
 * same card, which is exactly what earns an AI Overview citation on a
 * comparison query.
 *
 * THE CARD, TOP TO BOTTOM AND IN DOM ORDER: the question (h3), the verdict
 * sentence, the two players side by side with "vs" between them (each one
 * name, badge, position and team, projected points), a thin bar splitting
 * the pair's combined projection (aria-hidden; both figures are text right
 * above it), then the confidence word and the link to the board.
 *
 * ANCHOR VARIETY (section 2.2, and the project's own "vary anchor text,
 * never repeat an identical string on the page" rule). Every link already
 * names both players, so two different pairs never collide, but the same
 * pair can legitimately appear both in the grid and in its position's
 * "Closest calls" list (selectToughestCalls guarantees one grid pair per
 * position that has any, drawn from the same closeness-ordered list
 * byPosition already holds). GRID_ANCHOR_TEMPLATES and
 * CLOSEST_CALLS_ANCHOR_TEMPLATES are separate lists for exactly that case,
 * each rotated by the pair's position in its own list, so the same two
 * players never link with the same words twice on one page.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Swords } from "lucide-react";
import { PlayerHeadshot } from "@/components/player-headshot";
import { NflTeamLogo } from "@/components/nfl-team-logo";
import { StartSitBadge } from "@/components/start-sit-badge";
import { FeatureSectionHeader } from "@/components/feature-section-header";
import { POSITION_BADGE, POSITION_BADGE_FALLBACK } from "@/lib/on-the-clock/position-colors";
import { START_SIT_CALL_LABEL_TEXT } from "@/lib/start-sit/copy";
import { callLabelFor } from "@/lib/start-sit/confidence";
import {
  comparePairsByCloseness,
  TOUGHEST_CALLS_BY_POSITION_SIZE,
  type ToughestCallsPair,
  type ToughestCallsPlayer,
  type ToughestCallsResult,
} from "@/lib/start-sit/toughest-calls";
import type { StartSitPositionKey } from "./written-sections";

/* ------------------------------------------------------------------ */
/* Small shared helpers                                                */
/* ------------------------------------------------------------------ */

/** One decimal, matching the pts() convention start-sit-card.tsx uses. */
function pts(value: number): string {
  return value.toFixed(1);
}

/** The last token of a display name, for the compact anchor phrasing. Falls back to the whole name if there is only one token. */
function lastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] || name;
}

function pairKey(pair: ToughestCallsPair): string {
  return `${pair.a.slug}-${pair.b.slug}`;
}

function boardHref(basePath: string, pair: ToughestCallsPair): string {
  return `${basePath}?p=${pair.a.slug},${pair.b.slug}`;
}

const BEACON_HAIRLINE = "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)";

/** A player's photo, or the team logo for a defense. Always decorative: the name is text beside it. */
function PlayerAvatar({ player, size, framed }: { player: ToughestCallsPlayer; size: number; framed?: "start" | "sit" }) {
  const frame = framed === "start" ? "bg-beacon p-[2px]" : framed === "sit" ? "bg-line-accent p-px" : "";
  const inner =
    player.position === "DEF" ? (
      <span
        className="flex items-center justify-center rounded-md border border-line bg-base"
        style={{ width: size, height: size }}
      >
        <NflTeamLogo team={player.team ?? player.sleeperId} size={Math.round(size * 0.75)} />
      </span>
    ) : (
      <PlayerHeadshot sleeperId={player.sleeperId} name="" size={size} className={framed ? "!border-0" : ""} />
    );
  return (
    <span aria-hidden="true" className={`block rounded-lg ${frame}`}>
      {inner}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* The toughest-calls grid                                             */
/* ------------------------------------------------------------------ */

const GRID_ANCHOR_TEMPLATES: Array<(a: string, b: string) => string> = [
  (a, b) => `Compare ${a} and ${b}`,
  (a, b) => `Run ${a} against ${b}`,
  (a, b) => `Open the ${a} vs ${b} board`,
  (a, b) => `See who wins, ${a} or ${b}`,
];

function gridAnchorText(pair: ToughestCallsPair, index: number): string {
  const template = GRID_ANCHOR_TEMPLATES[index % GRID_ANCHOR_TEMPLATES.length];
  return template(lastName(pair.a.name), lastName(pair.b.name));
}

export function ToughestCalls({
  result,
  basePath,
  week,
}: {
  result: ToughestCallsResult;
  /** The board's own path, e.g. "/tools/who-should-i-start"; every link is {basePath}?p=a,b. */
  basePath: string;
  week: number;
}) {
  return (
    <section aria-labelledby="toughest-calls" className="space-y-6">
      <FeatureSectionHeader
        id="toughest-calls"
        icon={Swords}
        tone="purple"
        eyebrow={`Week ${week}`}
        title={<>This week&apos;s toughest start/sit calls</>}
        intro={
          result.grid.length > 0
            ? `Real Week ${week} comparisons with the verdict already worked out. Open any of them on the board for the full breakdown.`
            : undefined
        }
      />

      {result.grid.length === 0 ? (
        <p className="rounded-modal border border-dashed border-line-accent bg-surface/30 px-5 py-4 leading-relaxed text-ink-muted">
          Week {week}&apos;s projections are not published yet, so there is nothing close enough to call a toughest
          matchup. Check back once this week&apos;s numbers are in, or put any two players into the board above.
        </p>
      ) : (
        <ul role="list" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {result.grid.map((pair, index) => (
            <li key={pairKey(pair)}>
              <ToughestCallCard pair={pair} basePath={basePath} index={index} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ToughestCallCard({
  pair,
  basePath,
  index,
}: {
  pair: ToughestCallsPair;
  basePath: string;
  index: number;
}) {
  const cardId = `toughest-call-${pairKey(pair)}`;
  const headingId = `${cardId}-title`;
  const confidenceLabel = START_SIT_CALL_LABEL_TEXT[callLabelFor(pair.confidence)];

  return (
    <article id={cardId} aria-labelledby={headingId} className="h-full">
      <div className="relative flex h-full flex-col overflow-hidden rounded-modal border border-line bg-surface/50 transition-colors hover:border-line-accent">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{ backgroundImage: BEACON_HAIRLINE }}
        />
        <div className="px-4 pt-4">
          <h3 id={headingId} className="text-base font-bold leading-snug tracking-tight text-ink">
            {pair.a.name} or {pair.b.name}?
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{pair.verdict}</p>
        </div>

        <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2 px-4">
          <PlayerSide player={pair.a} points={pair.pointsA} call="start" />
          <span className="mt-4 flex h-8 w-8 items-center justify-center rounded-full border border-line-accent bg-base text-[10px] font-extrabold uppercase tracking-wide text-ink-subtle">
            vs
          </span>
          <PlayerSide player={pair.b} points={pair.pointsB} call="sit" />
        </div>

        <PointsSplit a={pair.pointsA} b={pair.pointsB} />

        <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
          <span className="rounded-full border border-line-accent/50 bg-base px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-ink">
            {confidenceLabel}
          </span>
          <Link
            href={boardHref(basePath, pair)}
            className="group inline-flex min-h-11 items-center gap-1.5 rounded-card border border-brand-cyan/40 bg-brand-cyan/10 px-3 text-sm font-semibold text-brand-cyan transition-colors hover:bg-brand-cyan/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            {gridAnchorText(pair, index)}
            <ArrowRight
              aria-hidden="true"
              className="h-4 w-4 shrink-0 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5"
            />
          </Link>
        </div>
      </div>
    </article>
  );
}

/** One side of a toughest-call card: photo, name, START/SIT badge, position and team, projected points. */
function PlayerSide({
  player,
  points,
  call,
}: {
  player: ToughestCallsPlayer;
  points: number;
  call: "start" | "sit";
}) {
  const positionClass = POSITION_BADGE[player.position] ?? POSITION_BADGE_FALLBACK;

  return (
    <div className="flex min-w-0 flex-col items-center text-center">
      <PlayerAvatar player={player} size={52} framed={call} />
      <p className="mt-2 text-sm font-semibold leading-tight text-ink [overflow-wrap:anywhere]">{player.name}</p>
      <StartSitBadge call={call} size="sm" className="mt-1.5" />
      <p className="mt-1.5 flex flex-wrap items-center justify-center gap-1">
        <span
          className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${positionClass}`}
        >
          {player.position}
        </span>
        {player.team && (
          <span className="inline-flex items-center gap-1 text-xs text-ink-subtle">
            <NflTeamLogo team={player.team} size={14} />
            {player.team}
          </span>
        )}
      </p>
      <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-ink">
        {pts(points)}
        <span className="sr-only"> projected points</span>
      </p>
    </div>
  );
}

/**
 * The pair's combined projection, split by player. A near-even bar is the
 * visual version of "toughest call". aria-hidden: both figures are printed
 * as text directly above it.
 */
function PointsSplit({ a, b }: { a: number; b: number }) {
  const total = a + b;
  if (!(total > 0)) return null;
  const share = Math.min(98, Math.max(2, (a / total) * 100));
  return (
    <div aria-hidden="true" className="pointer-events-none mx-4 mb-4 mt-4 flex h-1.5 gap-[2px]">
      <span className="rounded-l-full bg-signal-success" style={{ width: `${share}%` }} />
      <span className="flex-1 rounded-r-full bg-line-accent" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Closest calls at {position}                                         */
/* ------------------------------------------------------------------ */

const CLOSEST_CALLS_ANCHOR_TEMPLATES: Array<(a: string, b: string) => string> = [
  (a, b) => `Full breakdown: ${a} vs ${b}`,
  (a, b) => `Put ${a} and ${b} on the board`,
  (a, b) => `Check ${a} against ${b}`,
];

function closestCallAnchorText(pair: ToughestCallsPair, index: number): string {
  const template = CLOSEST_CALLS_ANCHOR_TEMPLATES[index % CLOSEST_CALLS_ANCHOR_TEMPLATES.length];
  return template(lastName(pair.a.name), lastName(pair.b.name));
}

/**
 * One position's "Closest calls" list: up to three pairs, each the two
 * photos, the verdict sentence and a link that opens the board pre-filled.
 * Renders nothing (not even an empty list) when there are no pairs, so a
 * caller never has to guard the empty case itself.
 */
export function ClosestCallsList({
  pairs,
  basePath,
}: {
  pairs: ToughestCallsPair[];
  basePath: string;
}) {
  if (pairs.length === 0) return null;

  return (
    <ul role="list" className="space-y-2.5">
      {pairs.map((pair, index) => (
        <li key={pairKey(pair)} className="flex gap-3 rounded-card border border-line bg-base/40 p-3">
          <span className="flex shrink-0 -space-x-2 pt-0.5">
            <PlayerAvatar player={pair.a} size={30} />
            <PlayerAvatar player={pair.b} size={30} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-relaxed text-ink-muted">{pair.verdict}</p>
            <Link
              href={boardHref(basePath, pair)}
              className="group mt-0.5 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand-cyan hover:underline hover:underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              {closestCallAnchorText(pair, index)}
              <ArrowRight
                aria-hidden="true"
                className="h-3.5 w-3.5 shrink-0 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5"
              />
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Everything closestCalls maps to except FLEX, which is never populated (see buildStartSitClosestCalls). */
type ClosestCallsPositionKey = Exclude<StartSitPositionKey, "FLEX">;

const CLOSEST_CALLS_POSITION_LABEL: Record<ClosestCallsPositionKey, string> = {
  QB: "quarterback",
  RB: "running back",
  WR: "wide receiver",
  TE: "tight end",
  K_DEF: "defense and kicker",
};

/** The heading plus the list, for one position, as one written-sections closestCalls slot. */
function ClosestCallsSection({
  position,
  pairs,
  basePath,
}: {
  position: ClosestCallsPositionKey;
  pairs: ToughestCallsPair[];
  basePath: string;
}) {
  const headingId = `closest-calls-${position.toLowerCase()}`;
  return (
    <div className="rounded-modal border border-line bg-surface/50 p-4">
      <h3
        id={headingId}
        className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-ink-subtle"
      >
        <Swords aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-brand-purple" />
        Closest calls at {CLOSEST_CALLS_POSITION_LABEL[position]} this week
      </h3>
      <div className="mt-3">
        <ClosestCallsList pairs={pairs} basePath={basePath} />
      </div>
    </div>
  );
}

/**
 * Maps the loader's byPosition into written-sections.tsx's closestCalls
 * prop shape (Partial<Record<"QB"|"RB"|"WR"|"TE"|"FLEX"|"K_DEF", ReactNode>>).
 *
 * QB, RB, WR and TE map directly from their own byPosition list. K and DEF
 * are merged into one K_DEF slot, re-sorted by the same closeness order the
 * grid uses and capped at TOUGHEST_CALLS_BY_POSITION_SIZE total, because the
 * page carries one combined "Who should I start at defense and kicker?" H2,
 * not two separate ones.
 *
 * FLEX IS DELIBERATELY LEFT EMPTY. selectToughestCalls only ever pairs two
 * players within the SAME position (the pairing window walks one position's
 * own points-ordered list); there is no cross-position pair anywhere in a
 * ToughestCallsResult, so there is nothing honest to call a "closest flex
 * call" here. written-sections.tsx already renders nothing when a slot is
 * absent, so simply never setting FLEX is the whole fix.
 */
export function buildStartSitClosestCalls(
  byPosition: ToughestCallsResult["byPosition"],
  basePath: string,
): Partial<Record<StartSitPositionKey, ReactNode>> {
  const out: Partial<Record<StartSitPositionKey, ReactNode>> = {};

  const direct: Array<"QB" | "RB" | "WR" | "TE"> = ["QB", "RB", "WR", "TE"];
  for (const position of direct) {
    const pairs = byPosition[position] ?? [];
    if (pairs.length === 0) continue;
    out[position] = <ClosestCallsSection position={position} pairs={pairs} basePath={basePath} />;
  }

  const kDef = [...(byPosition.K ?? []), ...(byPosition.DEF ?? [])]
    .sort(comparePairsByCloseness)
    .slice(0, TOUGHEST_CALLS_BY_POSITION_SIZE);
  if (kDef.length > 0) {
    out.K_DEF = <ClosestCallsSection position="K_DEF" pairs={kDef} basePath={basePath} />;
  }

  return out;
}
