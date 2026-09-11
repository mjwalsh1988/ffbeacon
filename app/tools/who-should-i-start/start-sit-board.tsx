/**
 * The Who Should I Start result: the verdict, the card row, the confidence
 * bar, the reasons and the copy buttons.
 *
 * Plan: docs/seo/who-should-i-start-and-site-seo-plan.md section 2.5 items 1
 * through 5 (the loading, error, not-found, live-week and mobile states are
 * in the same section), section 2.9 (the file list), section 2.10 (the share
 * image URL) and section 2.14 (the accessibility contract). Server
 * component; the only client code this file needs is the "Show as a list"
 * toggle, factored out to ./card-row-toggle.tsx so this file stays server
 * only.
 *
 * READING ORDER, WHICH IS ALSO THE DOM ORDER.
 *   1. The not-found / refused-player alert (role="alert"), when the request
 *      named a slug this board could not evaluate. Told first, so a reader
 *      hears about missing data before a verdict that may not be using every
 *      player they asked for.
 *   2. The verdict panel. Its "The verdict" eyebrow is static text; the
 *      sentence under it is role="status", THE ONLY LIVE ANNOUNCEMENT OF THE
 *      RESULT on this board: every other message on the page is a static
 *      sentence, never a second live region repeating the call.
 *   3. The "no projections yet" note, when nothing has synced for this
 *      source and week at all (board.updatedAt is null).
 *   4. The live-week note, when the selected week is the current week and at
 *      least one candidate's game has already kicked off.
 *   5. The "Show as a list" toggle, then the card row: starters first, then
 *      the bench, each group in descending projected points, matching
 *      verdict.starters and verdict.bench (already ordered by
 *      lib/start-sit/rank.ts).
 *   6. The notes under the card row: that every range bar shares one scale,
 *      and (only when the page supplied a market map) that value is a trade
 *      price rather than this week's points.
 *   7. The confidence meter (a WinProbBar) or its null-confidence sentence,
 *      beside the reasons on a wide screen and above them on a narrow one.
 *   8. The reasons list.
 *   9. Copy link and Copy as image.
 *
 * THE CARD ROW IS RENDERED TWICE, NOT CONDITIONALLY. CardRowToggle needs both
 * the scroll-row tree and the stacked-list tree mounted so it can toggle
 * `hidden` on whichever is inactive; see that file's header for why. Nothing
 * here reads which one is visible, so both use the exact same card data in
 * the exact same order.
 *
 * THE ROW FILLS THE WIDTH IT HAS. From lg up each card grows to share the
 * row (never past 26rem, never under 300px) and the row centres itself with
 * `justify-content: safe center`, so two cards sit side by side across the
 * board instead of hugging the left edge, and eight still scroll. "safe"
 * matters: plain centring pushes the first card past the scroll origin of an
 * overflowing row, where no scroll can reach it.
 *
 * SHARE LINKS CARRY format AND source EXPLICITLY, even though the reader's
 * own header format and source drive the page by default. A shared link has
 * to reproduce the SAME verdict for whoever opens it next, not whatever
 * verdict their own site-header format happens to compute, so both the copy
 * link and the OG image URL pin format and source the way the plan's own OG
 * URL does (section 2.10): ?p=&start=&week=&format=&source=, source being
 * the VALUE source only (board.sourceSlug), never the projection source.
 */

import type { ReactNode } from "react";
import { Gauge, ListChecks, Sparkles } from "lucide-react";
import { StartSitCard, type StartSitCardMarket } from "./start-sit-card";
import type { RecentForm } from "./recent-form-chart";
import { CardRowToggle } from "./card-row-toggle";
import { WinProbBar } from "@/components/league-schedule/win-prob-bar";
import { CopyLinkButton } from "@/components/copy-link-button";
import { CopyImageButton } from "@/components/copy-image-button";
import { FeatureIconTile } from "@/components/feature-section-header";
import { START_SIT_CALL_LABEL_TEXT } from "@/lib/start-sit/copy";
import type { StartSitBoard as StartSitBoardData } from "@/lib/start-sit/load";
import type { StartSitCandidate, StartSitProjection, StartSitVerdict } from "@/lib/start-sit/types";

/** Market context for the header value source, keyed by players.id. Omitted entirely when the page has none to show. */
export type StartSitBoardMarketMap = Record<string, StartSitCardMarket>;

/** Recent graded weeks per player, keyed by players.id. A null entry renders the card's no-data sentence. */
export type StartSitBoardFormMap = Record<string, RecentForm | null>;

/**
 * The route the copy-link and copy-image URLs are built against. A prop, not
 * a hardcoded path, kept so this file needs no further change if the route
 * ever moves again. Defaults to the plan's decided final slug (section 2.3);
 * the page still passes its own TOOL_PATH from page-helpers.ts explicitly.
 */
const DEFAULT_BASE_PATH = "/tools/who-should-i-start";

const BEACON_HAIRLINE = "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)";

export function StartSitBoard({
  board,
  verdict,
  market,
  recentForm,
  basePath = DEFAULT_BASE_PATH,
}: {
  board: StartSitBoardData;
  verdict: StartSitVerdict;
  /** Value-source context per player, supplied by the page from the Beacon Breakdown group load. */
  market?: StartSitBoardMarketMap;
  /** Recent graded weeks per player, from the same group load. */
  recentForm?: StartSitBoardFormMap;
  basePath?: string;
}) {
  const candidateById = new Map<string, StartSitCandidate>(board.candidates.map((c) => [c.playerId, c]));
  const projectionById = new Map<string, StartSitProjection>(board.projections.map((p) => [p.playerId, p]));

  const missingAlert = buildMissingPlayersAlert(board);
  const noProjectionsYet = board.updatedAt === null;
  const liveWeek = board.week === board.currentWeek && anyGameKickedOff(board.projections);

  const shareParams = buildShareParams(board, verdict);
  const copyLinkHref = `${basePath}?${shareParams.toString()}`;
  const copyImageHref = `/api/og/start-sit?${shareParams.toString()}`;

  const orderedIds = [...verdict.starters, ...verdict.bench];
  const hasCards = orderedIds.length > 0;

  const scaleMax = rangeScaleMax(board.projections);
  const anyRange = board.projections.some(
    (p) => !p.onBye && p.points != null && p.floor != null && p.ceiling != null,
  );
  const hasReasons = verdict.reasons.length > 0;

  return (
    <div className="space-y-6">
      {missingAlert && (
        <p
          role="alert"
          className="rounded-card border border-signal-warning/40 bg-signal-warning/5 px-4 py-3 text-sm text-ink"
        >
          {missingAlert}
        </p>
      )}

      <div
        className="relative overflow-hidden rounded-modal border border-brand-cyan/30 bg-gradient-to-br from-brand-purple/[0.16] via-surface/70 to-brand-cyan/[0.10] px-5 py-5 sm:px-6"
        style={{ boxShadow: "0 0 90px -50px rgba(34, 211, 238, 0.6)" }}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{ backgroundImage: BEACON_HAIRLINE }}
        />
        <div className="flex items-start gap-4">
          <FeatureIconTile icon={Sparkles} size="md" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">The verdict</p>
            <p role="status" className="mt-1 text-lg font-semibold leading-snug text-ink sm:text-2xl">
              {verdict.verdictLine}
            </p>
          </div>
        </div>
      </div>

      {noProjectionsYet && (
        <p className="text-sm leading-relaxed text-ink-muted">
          No projections for Week {board.week} yet. Projections sync once a day, so check back soon.
        </p>
      )}

      {liveWeek && (
        <p className="text-sm leading-relaxed text-ink-muted">
          Games are underway. This verdict is what the projections said before kickoff.
        </p>
      )}

      {hasCards && board.candidates.length > 0 && (
        <>
          <CardRowToggle
            rowView={
              <CardRow
                orderedIds={orderedIds}
                verdict={verdict}
                candidateById={candidateById}
                projectionById={projectionById}
                formatLabel={board.format.display}
                market={market}
                recentForm={recentForm}
                scaleMax={scaleMax}
                layout="row"
              />
            }
            listView={
              <CardRow
                orderedIds={orderedIds}
                verdict={verdict}
                candidateById={candidateById}
                projectionById={projectionById}
                formatLabel={board.format.display}
                market={market}
                recentForm={recentForm}
                scaleMax={scaleMax}
                layout="stack"
              />
            }
          />

          <div className="space-y-1 text-xs leading-relaxed text-ink-subtle">
            {anyRange && (
              <p>
                Each range bar runs from floor to ceiling on one shared scale, 0 to {scaleMax} points, so the bars
                compare across cards.
              </p>
            )}
            {market && Object.keys(market).length > 0 && (
              <p>Value is the player&apos;s trade price. This week&apos;s points are the projection above.</p>
            )}
          </div>
        </>
      )}

      <div className={`grid gap-4 ${hasReasons ? "lg:grid-cols-2" : ""}`}>
        <ConfidenceMeter verdict={verdict} candidateById={candidateById} />

        {hasReasons && (
          <div className="rounded-modal border border-line bg-surface/40 p-4 sm:p-5">
            <div className="mb-3 flex items-center gap-3">
              <FeatureIconTile icon={ListChecks} tone="purple" size="sm" />
              <h3 className="text-sm font-bold uppercase tracking-wide text-ink">Why</h3>
            </div>
            <ul role="list" className="space-y-2.5">
              {verdict.reasons.map((reason) => (
                <li key={reason} className="flex gap-2.5 text-sm leading-relaxed text-ink-muted">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-cyan" />
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <CopyLinkButton href={copyLinkHref} ariaLabel="Copy link to this start/sit verdict" />
        <CopyImageButton
          imageHref={copyImageHref}
          ariaLabel="Copy this start/sit verdict as an image"
          description={verdict.verdictLine}
        />
      </div>
    </div>
  );
}

/**
 * Starters first, then the bench, each group already in descending projected
 * points (lib/start-sit/rank.ts). One `<ul role="list">` either way; only the
 * card `layout` prop and the wrapping classes change between the scroll row
 * and the stacked list.
 */
function CardRow({
  orderedIds,
  verdict,
  candidateById,
  projectionById,
  formatLabel,
  market,
  recentForm,
  scaleMax,
  layout,
}: {
  orderedIds: string[];
  verdict: StartSitVerdict;
  candidateById: Map<string, StartSitCandidate>;
  projectionById: Map<string, StartSitProjection>;
  formatLabel: string;
  market: StartSitBoardMarketMap | undefined;
  recentForm: StartSitBoardFormMap | undefined;
  scaleMax: number;
  layout: "row" | "stack";
}) {
  const totalStarters = verdict.starters.length;

  const items: ReactNode[] = orderedIds.map((playerId) => {
    const candidate = candidateById.get(playerId);
    const projection = projectionById.get(playerId);
    if (!candidate || !projection) return null;

    const starterRank = verdict.starters.indexOf(playerId);
    const isStarter = starterRank !== -1;

    return (
      <li
        key={playerId}
        className={
          layout === "row"
            ? "w-[288px] shrink-0 snap-start sm:w-[320px] lg:w-auto lg:min-w-[300px] lg:max-w-[26rem] lg:flex-1"
            : undefined
        }
      >
        <StartSitCard
          candidate={candidate}
          projection={projection}
          call={isStarter ? "start" : "sit"}
          rank={isStarter ? starterRank + 1 : undefined}
          total={isStarter ? totalStarters : undefined}
          reason={isStarter ? undefined : sitReasonFor(projection)}
          formatLabel={formatLabel}
          market={market?.[playerId] ?? null}
          recentForm={recentForm?.[playerId] ?? null}
          scaleMax={scaleMax}
          layout={layout}
        />
      </li>
    );
  });

  if (layout === "stack") {
    return (
      <ul role="list" className="mx-auto max-w-2xl space-y-4">
        {items}
      </ul>
    );
  }

  return (
    <div
      tabIndex={0}
      role="region"
      aria-label="Start/sit player cards"
      className="overflow-x-auto rounded-modal border border-line bg-surface/20 p-1 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-cyan"
    >
      <p className="sr-only">
        A horizontally scrolling row of {orderedIds.length} player cards, starters first. Use the &quot;Show as a
        list&quot; button above to read them stacked instead.
      </p>
      <ul role="list" className="flex snap-x snap-mandatory gap-4 p-3 [justify-content:safe_center]">
        {items}
      </ul>
    </div>
  );
}

/**
 * The shared top of every card's range strip: the highest ceiling on the
 * board (or projection, where a card has no ceiling), rounded up to a clean
 * multiple of five and never below five.
 */
function rangeScaleMax(projections: StartSitProjection[]): number {
  let peak = 0;
  for (const p of projections) {
    const top = p.ceiling ?? p.points;
    if (top != null && top > peak) peak = top;
  }
  return Math.max(5, Math.ceil(peak / 5) * 5);
}

/** "Bye week" for onBye, "Ruled out" for an "out" availability, undefined otherwise (a plain "Sit"). */
function sitReasonFor(projection: StartSitProjection): string | undefined {
  if (projection.onBye) return "Bye week";
  if (projection.availability === "out") return "Ruled out";
  return undefined;
}

/**
 * The confidence meter: a WinProbBar for the last starter against the first
 * benched player, or a plain sentence when confidence is null. Section 2.5
 * item 3.
 */
function ConfidenceMeter({
  verdict,
  candidateById,
}: {
  verdict: StartSitVerdict;
  candidateById: Map<string, StartSitCandidate>;
}) {
  const lastStarterId = verdict.starters[verdict.starters.length - 1];
  const firstBenchId = verdict.bench[0];
  const lastStarter = lastStarterId ? candidateById.get(lastStarterId) : null;
  const firstBench = firstBenchId ? candidateById.get(firstBenchId) : null;
  const measured = verdict.confidence != null && lastStarter && firstBench;

  return (
    <div className="rounded-modal border border-line bg-surface/40 p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <FeatureIconTile icon={Gauge} size="sm" />
          <h3 className="text-sm font-bold uppercase tracking-wide text-ink">Confidence</h3>
        </div>
        {measured && (
          <span className="rounded-full border border-line-accent/50 bg-base px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-ink">
            {START_SIT_CALL_LABEL_TEXT[verdict.callLabel]}
          </span>
        )}
      </div>
      {measured ? (
        <WinProbBar
          homeName={(lastStarter as StartSitCandidate).name}
          awayName={(firstBench as StartSitCandidate).name}
          homeProb={verdict.confidence as number}
        />
      ) : (
        <p className="text-sm leading-relaxed text-ink-muted">
          {START_SIT_CALL_LABEL_TEXT.unmeasured}: not enough graded history to put a probability on this call.
        </p>
      )}
    </div>
  );
}

/**
 * "We couldn't find X and Y. ..." plus "A and B play a position this tool
 * does not evaluate." combined into one sentence pair, following the same
 * wording the pre-refactor page used for its own not-found state. Null when
 * every requested slug resolved to an evaluable player.
 */
function buildMissingPlayersAlert(board: StartSitBoardData): string | null {
  const parts: string[] = [];

  if (board.notFoundSlugs.length > 0) {
    const count = board.notFoundSlugs.length;
    parts.push(
      `We couldn't find ${count === 1 ? "one of the players" : `${count} of the players`} you added. They may be inactive or the link may be out of date.`,
    );
  }

  if (board.refusedPlayers.length > 0) {
    const names = joinWithAnd(board.refusedPlayers.map((p) => `${p.name} (${p.position})`));
    const verb = board.refusedPlayers.length === 1 ? "plays" : "play";
    parts.push(`${names} ${verb} a position this tool does not evaluate.`);
  }

  return parts.length > 0 ? parts.join(" ") : null;
}

/** "A", "A and B", "A, B, and C". Small local copy of the same helper in lib/start-sit/reasons.ts, which does not export it. */
function joinWithAnd(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** True once at least one candidate's game has kicked off, by the environment's own kickoff time. */
function anyGameKickedOff(projections: StartSitProjection[]): boolean {
  const now = Date.now();
  return projections.some((p) => {
    const kickoff = p.environment?.kickoffAt;
    if (!kickoff) return false;
    const t = new Date(kickoff).getTime();
    return Number.isFinite(t) && t <= now;
  });
}

/**
 * ?p=&start=&week=&format=&source= for both the copy-link URL and the OG
 * image URL (section 2.10), so a shared link and its preview image always
 * agree with each other and with the board that produced them. week is
 * included even at the live week: the plan's OG URL always carries it, and a
 * reader who saves the link across a week rollover should keep seeing THIS
 * week's verdict, not whatever week is live when they reopen it. source is
 * the value source only (board.sourceSlug), never the projection source,
 * which is not a reader choice.
 */
function buildShareParams(board: StartSitBoardData, verdict: StartSitVerdict): URLSearchParams {
  const params = new URLSearchParams();
  params.set("p", board.candidates.map((c) => c.slug).join(","));
  params.set("start", String(verdict.startCount));
  params.set("week", String(board.week));
  params.set("format", board.format.slug);
  if (board.sourceSlug) params.set("source", board.sourceSlug);
  return params;
}
