import {
  ArrowDownLeft,
  ArrowUpRight,
  CircleSlash,
  MinusCircle,
  ThumbsDown,
  ThumbsUp,
  TrendingDown,
  TrendingUp,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { PLAYER_PHOTO_RADIUS, PlayerHeadshot } from "@/components/player-headshot";
import { PickTag } from "@/components/trade-ideas/pick-tag";
import { GuideTermLink } from "@/components/signal-guide/guide-term-link";
import { ordinal } from "@/components/league-schedule/format";
import {
  readAsset,
  assetFigures,
  byImportance,
  positionalWarSentence,
} from "@/lib/trade-impact/asset-notes";
import type {
  AssetTone,
  AssetVerdict,
  PositionalWarContext,
} from "@/lib/trade-impact/asset-notes";
import type { TradeOutcome, OutcomeCall } from "@/lib/trade-impact/outcome";
import type { ImpactGaps, ResolvedAsset, TeamImpact } from "@/lib/trade-impact/types";

/**
 * The answer, at the top, before any of the working.
 *
 * WHAT WAS WRONG WITH THE PAGE WITHOUT IT
 *   The evaluation opened on its reasons. Every one of them is true and none of
 *   them is what a reader came for. To learn whether to accept, they read four
 *   paragraphs, two tables and a week-by-week chart, and did the subtraction
 *   themselves. This says it in three words and then shows the arithmetic.
 *
 * THREE THINGS, IN THIS ORDER
 *   1. THE CALL. Take it, lean, close, decline, with the value margin printed
 *      big beside it and one sentence naming the measure that decided.
 *   2. THE BALANCE. One bar, two segments, who is getting more. Next to it the
 *      three season figures as deltas, because a trade that wins on value and
 *      loses on wins has to show both or it is lying by omission.
 *   3. THE ASSETS. Every piece with a large photo and a plain sentence on what
 *      it does for this roster. This is where "6,000 value" becomes "starts nine
 *      of eleven weeks for you", which is the fact a manager is actually after.
 *
 * COLOUR IS NEVER THE ANSWER ON ITS OWN
 *   The call is a word before it is a colour, every tone chip carries its own
 *   label, and each arrow icon is paired with text. The graph is aria-hidden
 *   with a sentence beneath it that states the same split in words, the pattern
 *   app/tools/signal-check/trade-margin-graph.tsx already set.
 *
 * WHY THE VERDICT IS NOT GENERATED
 *   See lib/trade-impact/outcome.ts. Every figure here comes from the model, by
 *   rules written out in the open, and the summary names one so the call can be
 *   argued with. An unarguable verdict is one nobody should trust.
 *
 * Server component: props in, markup out.
 */

const CALL_STYLE: Record<
  OutcomeCall,
  { icon: LucideIcon; ring: string; text: string; wash: string; glow: string }
> = {
  take: {
    icon: Trophy,
    ring: "border-signal-success/50",
    text: "text-signal-success",
    wash: "radial-gradient(ellipse at 0% 0%, rgba(16,185,129,0.16) 0%, transparent 60%), radial-gradient(ellipse at 100% 0%, rgba(34,211,238,0.12) 0%, transparent 64%)",
    glow: "shadow-[0_0_80px_-50px_rgba(16,185,129,0.9)]",
  },
  "lean-yes": {
    icon: ThumbsUp,
    ring: "border-brand-cyan/50",
    text: "text-brand-cyan",
    wash: "radial-gradient(ellipse at 0% 0%, rgba(34,211,238,0.16) 0%, transparent 60%), radial-gradient(ellipse at 100% 0%, rgba(168,85,247,0.10) 0%, transparent 64%)",
    glow: "shadow-[0_0_80px_-50px_rgba(34,211,238,0.9)]",
  },
  close: {
    icon: MinusCircle,
    ring: "border-line-accent",
    text: "text-ink",
    wash: "radial-gradient(ellipse at 0% 0%, rgba(168,85,247,0.12) 0%, transparent 58%), radial-gradient(ellipse at 100% 0%, rgba(34,211,238,0.10) 0%, transparent 62%)",
    glow: "shadow-[0_0_80px_-50px_rgba(168,85,247,0.8)]",
  },
  "lean-no": {
    icon: ThumbsDown,
    ring: "border-signal-warning/50",
    text: "text-signal-warning",
    wash: "radial-gradient(ellipse at 0% 0%, rgba(245,158,11,0.14) 0%, transparent 60%), radial-gradient(ellipse at 100% 0%, rgba(168,85,247,0.10) 0%, transparent 64%)",
    glow: "shadow-[0_0_80px_-50px_rgba(245,158,11,0.9)]",
  },
  decline: {
    icon: CircleSlash,
    ring: "border-signal-danger/50",
    text: "text-signal-danger",
    wash: "radial-gradient(ellipse at 0% 0%, rgba(239,68,68,0.14) 0%, transparent 60%), radial-gradient(ellipse at 100% 0%, rgba(168,85,247,0.10) 0%, transparent 64%)",
    glow: "shadow-[0_0_80px_-50px_rgba(239,68,68,0.9)]",
  },
};

const TONE_CHIP: Record<AssetTone, string> = {
  good: "border-signal-success/50 bg-signal-success/10 text-signal-success",
  bad: "border-signal-danger/50 bg-signal-danger/10 text-signal-danger",
  neutral: "border-line-accent bg-ink-subtle/10 text-ink-muted",
};

function fmtValue(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function signed(value: number, digits = 1): string {
  const rounded = Number(value.toFixed(digits));
  const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : "";
  return `${sign}${Math.abs(rounded).toFixed(digits)}`;
}

export function TradeOutcomePanel({
  outcome,
  mine,
  gaps,
  weeksConsidered,
  isDynasty,
  myTeamLabel,
  theirTeamLabel,
  sleeperLeagueId,
  positionalWarByPlayer,
}: {
  outcome: TradeOutcome;
  mine: TeamImpact;
  gaps: ImpactGaps;
  weeksConsidered: number;
  isDynasty: boolean;
  myTeamLabel: string;
  theirTeamLabel: string;
  /** For the asset card's Signal Guide link. */
  sleeperLeagueId: string;
  /**
   * Positional WAR for this league season, keyed by Sleeper id. Read only,
   * built once by the page (lib/trade-impact/positional-war-context.ts) and
   * handed down; absent on a league with no cached curve, which is not an
   * error, so the block simply does not render for any asset.
   */
  positionalWarByPlayer?: Map<string, PositionalWarContext>;
}) {
  const style = CALL_STYLE[outcome.call];
  const Icon = style.icon;

  return (
    <section
      aria-labelledby="trade-outcome-title"
      className={`relative overflow-hidden rounded-modal border bg-surface ${style.ring} ${style.glow}`}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ backgroundImage: style.wash }}
      />
      {/* The beacon gradient hairline every elevated surface on the site wears.
          pointer-events-none, like the wash above it: an absolutely positioned
          decorative span across the top of a card is exactly the layer that
          swallows a hover and leaves a screen reader following the mouse with
          nothing to announce. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
        }}
      />

      <div className="relative p-5 sm:p-6">
        <Headline outcome={outcome} icon={Icon} accent={style.text} />

        <div className="mt-6 grid gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <BalanceBar
              outcome={outcome}
              myTeamLabel={myTeamLabel}
              theirTeamLabel={theirTeamLabel}
            />
          </div>
          <div className="lg:col-span-2">
            <SeasonStrip outcome={outcome} gaps={gaps} />
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <AssetColumn
            direction="incoming"
            heading="You receive"
            teamLabel={theirTeamLabel}
            assets={mine.incoming}
            mine={mine}
            gaps={gaps}
            weeksConsidered={weeksConsidered}
            isDynasty={isDynasty}
            sleeperLeagueId={sleeperLeagueId}
            positionalWarByPlayer={positionalWarByPlayer}
          />
          <AssetColumn
            direction="outgoing"
            heading="You send"
            teamLabel={myTeamLabel}
            assets={mine.outgoing}
            mine={mine}
            gaps={gaps}
            weeksConsidered={weeksConsidered}
            isDynasty={isDynasty}
            sleeperLeagueId={sleeperLeagueId}
            positionalWarByPlayer={positionalWarByPlayer}
          />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Headline                                                            */
/* ------------------------------------------------------------------ */

function Headline({
  outcome,
  icon: Icon,
  accent,
}: {
  outcome: TradeOutcome;
  icon: LucideIcon;
  accent: string;
}) {
  // "Even" has no winner, so the number describes a spread rather than an edge.
  const marginCaption =
    outcome.valueFavours === "even"
      ? "value spread"
      : outcome.valueFavours === "you"
        ? "value your way"
        : "value their way";

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
          The call
        </p>
        <h2
          id="trade-outcome-title"
          className={`mt-1 flex items-center gap-2.5 text-2xl font-bold leading-tight tracking-tight sm:text-3xl ${accent}`}
        >
          <Icon aria-hidden="true" className="h-6 w-6 shrink-0 sm:h-7 sm:w-7" />
          {outcome.headline}
        </h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-muted">
          {outcome.summary}
        </p>
        {outcome.split && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-signal-warning/40 bg-signal-warning/10 px-2.5 py-1 text-[11px] font-semibold text-signal-warning">
            Value and wins disagree on this one
          </p>
        )}
      </div>

      {/* The number, big. Same gradient treatment Signal Check gives its margin,
          so a reader who knows one recognises the other. */}
      <div className="shrink-0 sm:text-right">
        <p
          className="bg-clip-text font-mono text-4xl font-bold tabular-nums text-transparent sm:text-5xl"
          style={{
            backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
          }}
        >
          {Math.round(outcome.valueMarginPct)}%
        </p>
        <p className="text-[11px] text-ink-subtle">{marginCaption}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Balance bar                                                         */
/* ------------------------------------------------------------------ */

/**
 * One bar, two segments, who is getting more.
 *
 * A single split bar rather than two bars side by side: the question is how the
 * value divides, and a division reads as one thing being cut rather than as two
 * things being compared. The 50% mark is drawn so the eye can see which side of
 * even the split lands on without reading a number.
 *
 * Hidden from the accessibility tree with a sentence underneath, the same shape
 * app/tools/signal-check/trade-margin-graph.tsx uses.
 */
function BalanceBar({
  outcome,
  myTeamLabel,
  theirTeamLabel,
}: {
  outcome: TradeOutcome;
  myTeamLabel: string;
  theirTeamLabel: string;
}) {
  const you = Math.round(outcome.yourShare);
  const them = 100 - you;
  const spoken =
    outcome.valueFavours === "even"
      ? `On value, you receive ${you} percent of what is moving and ${theirTeamLabel} receives ${them} percent. The two sides are level.`
      : outcome.valueFavours === "you"
        ? `On value, you receive ${you} percent of what is moving and ${theirTeamLabel} receives ${them} percent, so you come out ${Math.round(outcome.valueMarginPct)} percent ahead.`
        : `On value, you receive ${you} percent of what is moving and ${theirTeamLabel} receives ${them} percent, so ${theirTeamLabel} comes out ${Math.round(outcome.valueMarginPct)} percent ahead.`;

  return (
    <div className="rounded-card border border-line bg-base/50 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-subtle">
        Value balance
      </p>

      <div aria-hidden="true" className="mt-3">
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="min-w-0 truncate font-semibold text-brand-cyan">
            You {you}%
          </span>
          <span className="min-w-0 truncate text-right font-semibold text-brand-purple">
            {them}% {theirTeamLabel}
          </span>
        </div>

        <div className="relative mt-1.5 flex h-3.5 overflow-hidden rounded-full border border-line-accent bg-base">
          <span
            className="h-full bg-brand-cyan/70 transition-[width]"
            style={{ width: `${you}%` }}
          />
          <span
            className="h-full flex-1 bg-brand-purple/70"
          />
          {/* Even, marked. Without it a 54/46 split and a 46/54 split look the
              same at a glance, and they are opposite answers. */}
          <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-ink/60" />
        </div>

        <div className="mt-2 flex items-baseline justify-between gap-2 font-mono text-[11px] tabular-nums text-ink-muted">
          <span>{fmtValue(outcome.valueIn)} in</span>
          <span>{fmtValue(outcome.valueOut)} out</span>
        </div>
      </div>

      <p className="sr-only">{spoken}</p>

      {outcome.lopsided && (
        <p className="mt-3 rounded-card border border-signal-warning/40 bg-signal-warning/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-signal-warning">
          A gap this wide is rarely accepted as it stands. Expect to add or ask for
          something.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Season strip                                                        */
/* ------------------------------------------------------------------ */

/**
 * The three season figures as deltas, next to the value bar rather than under
 * it, because the whole point is that they can disagree with it.
 *
 * These are the same numbers the Wins panel shows before and after. Here they
 * are only the change, because the change is what the trade caused and the
 * before-and-after is the working.
 */
function SeasonStrip({ outcome, gaps }: { outcome: TradeOutcome; gaps: ImpactGaps }) {
  const rows: Array<{ label: string; value: string; delta: number | null }> = [
    {
      label: "Projected wins",
      value: outcome.winsDelta === null ? "n/a" : signed(outcome.winsDelta),
      delta: outcome.winsDelta,
    },
    {
      label: "Playoff odds",
      value:
        outcome.playoffDeltaPp === null ? "n/a" : `${signed(outcome.playoffDeltaPp, 0)}pp`,
      delta: outcome.playoffDeltaPp,
    },
    {
      label: "Lineup, points a week",
      value: outcome.lineupDelta === null ? "n/a" : signed(outcome.lineupDelta),
      delta: outcome.lineupDelta,
    },
  ];

  return (
    <div className="h-full rounded-card border border-line bg-base/50 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-subtle">
        What it does to your season
      </p>
      <dl className="mt-3 space-y-2.5">
        {rows.map((row) => (
          <div
            key={row.label}
            // Marks the row holding the team-specific wins figure, so a test
            // can confirm the Positional WAR block on the asset card below
            // never lands inside this container. See asset-notes.ts for why
            // the two numbers are kept apart.
            data-role={row.label === "Projected wins" ? "wins-metric" : undefined}
            className="flex items-baseline justify-between gap-3"
          >
            <dt className="min-w-0 text-xs text-ink-muted">{row.label}</dt>
            <dd
              className={`shrink-0 font-mono text-sm font-bold tabular-nums ${
                row.delta === null
                  ? "text-ink-subtle"
                  : row.delta > 0
                    ? "text-signal-success"
                    : row.delta < 0
                      ? "text-signal-danger"
                      : "text-ink-muted"
              }`}
            >
              {/* The arrow is decorative; the sign is already in the number and
                  is what a screen reader reads. */}
              {row.delta !== null && row.delta > 0 && (
                <TrendingUp aria-hidden="true" className="mr-1 inline h-3.5 w-3.5" />
              )}
              {row.delta !== null && row.delta < 0 && (
                <TrendingDown aria-hidden="true" className="mr-1 inline h-3.5 w-3.5" />
              )}
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      {(gaps.simulation || gaps.lineup) && (
        <p className="mt-3 text-[11px] leading-relaxed text-ink-subtle">
          {gaps.simulation
            ? "No regular season games left, so the odds cannot be measured."
            : "No weekly projections in this league, so the lineup cannot be measured."}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Assets                                                              */
/* ------------------------------------------------------------------ */

/**
 * How many pieces of the whole trade sit at one position.
 *
 * A positional note can only be pinned on an asset when it is the ONLY thing
 * moving at that position. Two receivers crossing in opposite directions net out
 * to one number, and hanging that number on either of them would credit or blame
 * him for the other's effect.
 */
function positionCounts(mine: TeamImpact): Map<string, number> {
  const counts = new Map<string, number>();
  for (const asset of [...mine.incoming, ...mine.outgoing]) {
    if (asset.kind !== "player") continue;
    counts.set(asset.position, (counts.get(asset.position) ?? 0) + 1);
  }
  return counts;
}

function AssetColumn({
  direction,
  heading,
  teamLabel,
  assets,
  mine,
  gaps,
  weeksConsidered,
  isDynasty,
  sleeperLeagueId,
  positionalWarByPlayer,
}: {
  direction: "incoming" | "outgoing";
  heading: string;
  teamLabel: string;
  assets: ResolvedAsset[];
  mine: TeamImpact;
  gaps: ImpactGaps;
  weeksConsidered: number;
  isDynasty: boolean;
  sleeperLeagueId: string;
  positionalWarByPlayer?: Map<string, PositionalWarContext>;
}) {
  const incoming = direction === "incoming";
  const Arrow = incoming ? ArrowDownLeft : ArrowUpRight;
  const sideTotal = assets.reduce((total, a) => total + a.value, 0);
  const ordered = [...assets].sort(byImportance);
  const counts = positionCounts(mine);
  const positionDeltaFor = (asset: ResolvedAsset): number | null => {
    if (asset.kind !== "player") return null;
    if ((counts.get(asset.position) ?? 0) !== 1) return null;
    const before = mine.positionBefore[asset.position];
    const after = mine.positionAfter[asset.position];
    if (typeof before !== "number" || typeof after !== "number") return null;
    return after - before;
  };

  return (
    <section
      aria-label={`${heading}, from ${teamLabel}`}
      className={`rounded-card border p-3 ${
        incoming
          ? "border-brand-cyan/30 bg-brand-cyan/[0.04]"
          : "border-brand-purple/30 bg-brand-purple/[0.04]"
      }`}
    >
      <h3
        className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] ${
          incoming ? "text-brand-cyan" : "text-brand-purple"
        }`}
      >
        <Arrow aria-hidden="true" className="h-3.5 w-3.5" />
        {heading}
      </h3>
      <p className="mt-0.5 text-xs text-ink-subtle">
        {teamLabel} &middot; {fmtValue(sideTotal)} total
      </p>

      {ordered.length === 0 ? (
        <p className="mt-3 rounded-card border border-dashed border-line px-3 py-4 text-sm text-ink-muted">
          Nothing on this side.
        </p>
      ) : (
        <ul role="list" className="mt-3 space-y-2.5">
          {ordered.map((asset) => (
            <li key={asset.kind === "player" ? asset.playerId : asset.key}>
              <AssetCard
                asset={asset}
                verdict={readAsset(asset, {
                  direction,
                  sideTotal,
                  sideCount: ordered.length,
                  // Sorted by value, so the first row is the biggest piece.
                  isLargest: asset === ordered[0],
                  positionDelta: positionDeltaFor(asset),
                  weeksConsidered,
                  startWeeksByPlayer: mine.incomingStartWeeks ?? {},
                  noLineup: gaps.lineup,
                  isDynasty,
                  positionalWarByPlayer,
                })}
                incoming={incoming}
                sleeperLeagueId={sleeperLeagueId}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * One asset, at the size it deserves.
 *
 * The photo is 64px rather than the 40 the rest of the site uses. This is the
 * section where a reader is deciding, and a face is what makes a name land as a
 * player rather than as a row in a table. It is the same square at every
 * breakpoint: shrinking it on a phone would take the one thing that makes this
 * section feel like a decision and turn it back into a list.
 *
 * A centrepiece gets a brighter frame, so which player the deal is actually
 * about is visible before anything is read.
 */
function AssetCard({
  asset,
  verdict,
  incoming,
  sleeperLeagueId,
}: {
  asset: ResolvedAsset;
  verdict: AssetVerdict;
  incoming: boolean;
  sleeperLeagueId: string;
}) {
  const centrepiece = verdict.role === "centrepiece";
  return (
    <div
      className={`rounded-card border p-3 ${
        centrepiece
          ? incoming
            ? "border-brand-cyan/45 bg-surface-elevated"
            : "border-brand-purple/45 bg-surface-elevated"
          : "border-line bg-surface-elevated/60"
      }`}
    >
      <div className="flex items-start gap-3">
        {asset.kind === "player" ? (
          <PlayerHeadshot
            sleeperId={asset.sleeperId}
            name=""
            size={64}
            className="shrink-0 border border-line-accent"
          />
        ) : (
          <span
            aria-hidden="true"
            className={`flex h-16 w-16 shrink-0 items-center justify-center border border-brand-cyan/40 bg-brand-cyan/10 text-base font-extrabold text-brand-cyan ${PLAYER_PHOTO_RADIUS}`}
          >
            {ordinal(asset.round)}
          </span>
        )}

        <div className="min-w-0 flex-1">
          {asset.kind === "player" ? (
            <>
              <p className="truncate text-sm font-bold text-ink sm:text-base">
                {asset.name}
              </p>
              <p className="text-xs text-ink-muted">
                {[asset.position, asset.team].filter(Boolean).join(", ")}
              </p>
            </>
          ) : (
            <PickTag pick={asset} estimated={asset.positionEstimated} />
          )}

          {/* Comma, not a middle dot. A screen reader reads the dot aloud or
              skips it depending on the engine, and neither is the pause a
              reader wants between three figures. CLAUDE.md bans it outright. */}
          <p className="mt-1 font-mono text-[11px] tabular-nums text-ink-subtle">
            {assetFigures(asset).join(", ")}
          </p>
        </div>
      </div>

      {verdict.notes.length > 0 && (
        <ul role="list" className="mt-3 space-y-1.5">
          {verdict.notes.map((note) => (
            <li key={note.label} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span
                className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] ${TONE_CHIP[note.tone]}`}
              >
                {note.label}
              </span>
              <span className="min-w-0 flex-1 text-xs leading-relaxed text-ink-muted">
                {note.detail}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* League-wide scarcity for this asset's position, in its own block and
          never one of the notes above: those are roster-specific, and this
          number is read off a league-average team that owns nobody. See
          lib/trade-impact/asset-notes.ts and lib/positional-war/types.ts. */}
      {verdict.positionalWar && (
        <PositionalWarBlock
          context={verdict.positionalWar}
          sleeperLeagueId={sleeperLeagueId}
        />
      )}
    </div>
  );
}

/**
 * League-wide Positional WAR for one asset, kept apart from the notes above on
 * purpose: they describe what an asset does for THIS roster, and this number
 * describes the position in this league and knows nothing about who owns whom.
 * Constraint 3 of the extension plan: never the same column, row, or sentence
 * as a roster-specific figure such as projected wins.
 */
function PositionalWarBlock({
  context,
  sleeperLeagueId,
}: {
  context: PositionalWarContext;
  sleeperLeagueId: string;
}) {
  return (
    <div
      data-role="positional-war-block"
      className="mt-3 rounded-card border border-line bg-base/40 p-2.5"
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-purple">
        Positional WAR (league-wide)
      </p>
      {/* The heading directly above already names the metric, so the sentence
          does not repeat it. */}
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">
        {positionalWarSentence(context)}
      </p>
      {/* Real text, not an icon: this is the "link to the Signal Guide term"
          constraint 2 requires, and it now opens the guide IN PLACE at the
          Positional WAR entry rather than navigating to a page where that
          entry happens to surface. Trade Ideas is a registered guide page
          (migration 0217) and the term is global (migration 0213), so the
          panel exists here and GuideTermLink renders its button form. On a
          route with no guide, or before hydration, it renders the League
          Overview link this control used to be. Min height and width both
          cover the 44px tap target on a card with little room to spare. */}
      <GuideTermLink
        heading="Positional WAR"
        fallbackHref={`/leagues/${sleeperLeagueId}`}
        label="What is Positional WAR?"
        ariaLabel="What is Positional WAR? Open the Signal Guide entry for it."
        fallbackAriaLabel="What is Positional WAR? Open the Signal Guide entry for it on the League Overview page."
        className="mt-1.5 inline-flex min-h-11 min-w-11 items-center rounded-card px-1 text-left text-xs font-semibold text-brand-cyan underline decoration-brand-cyan/40 underline-offset-2 hover:text-brand-cyan/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      />
    </div>
  );
}
