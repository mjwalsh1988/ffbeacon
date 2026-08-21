import { ArrowDownLeft, ArrowUpRight, ChevronRight } from "lucide-react";
import { PLAYER_PHOTO_RADIUS, PlayerHeadshot } from "@/components/player-headshot";
import { Panel } from "@/components/dashboard-panel";
// The one ordinal in the codebase. Two hand-rolled ternaries is how "3th" got
// onto a pick badge in the first place.
import { ordinal } from "@/components/league-schedule/format";
import { ReasonList } from "@/components/trade-ideas/reason-list";
import { ImpactWeeks } from "@/components/trade-ideas/impact-weeks";
import { VerdictTabs } from "@/components/trade-ideas/verdict-tabs";
import type {
  ImpactGaps,
  ResolvedAsset,
  TeamImpact,
  TradeImpact,
} from "@/lib/trade-impact/types";

/**
 * The whole evaluation of one trade, suggested or built.
 *
 * TWO TABS, FOUR PANELS, ONE ORDER
 *   "Your season" carries the reasons, the week by week lineup effect, and what
 *   the deal does for the other team. "Value" carries what the assets are worth
 *   and the Signal Check second opinion. The two answer questions that routinely
 *   disagree, which is why they are two tabs rather than one long page: a deal
 *   can add value and cost wins, and a reader needs to check each without
 *   scrolling past the other. Inside a tab every panel is a real <section> with
 *   its own eyebrow and heading, so a screen reader user can jump straight to
 *   the part they care about.
 *
 * REASONS IS THE PRIMARY SURFACE
 *   Exactly one elevated panel per screen, and this is it: accent border, corner
 *   wash, and the beacon glow. The prose is the answer; the tiles and the table
 *   below it are the working. Putting the elevation on the numbers instead would
 *   invert that, and a reader would take the biggest box on the page as the
 *   conclusion when it is only the evidence.
 *
 * WHY A MISSING FIGURE GETS A SENTENCE
 *   `impact.gaps` is the model saying "I could not measure this", and the honest
 *   render of that is a sentence naming the reason. A zero would be a claim we
 *   have not earned, and a dash would leave a reader guessing whether the trade
 *   is neutral or whether the league is missing data. Both failures land hardest
 *   on someone hearing the page rather than scanning it, where "0.0" and "--"
 *   are read out as though they were results.
 *
 * BOTH SIDES SHOW EVERY FIGURE AT EVERY WIDTH
 *   The rule components/trade-finder-card.tsx sets for itself. Value, projected
 *   points, and age ride along on every asset, incoming and outgoing, on a phone
 *   as much as on a desktop. The only thing mobile changes is where the numbers
 *   wrap.
 *
 * Server component: props in, markup out. It fetches nothing. The tab switch is
 * the one client component, and it receives these panels as children.
 */

const UNAVAILABLE = "Not available";

const GAP_COPY = {
  lineup: "No weekly projections in this league, so lineup impact is unavailable.",
  simulation: "No regular season games left, so the odds are unavailable.",
  picks: "This league has no published pick values.",
} as const;

function fmtValue(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function fmtSigned(value: number, digits = 0): string {
  const rounded = Number(value.toFixed(digits));
  const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : "";
  return `${sign}${Math.abs(rounded).toFixed(digits)}`;
}

function fmtOdds(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return UNAVAILABLE;
  return `${Math.round(value * 100)}%`;
}

/**
 * Signal Check's explanation opens by restating its own verdict, which is right
 * on its own page and wrong here, where the verdict is the line directly above
 * it. Left alone it reads "Fair Trade. Fair Trade Neither side comes out ahead."
 * The same trim components/trade-finder-card.tsx applies for the same reason.
 */
function stripVerdictPrefix(explanation: string, verdict: string): string {
  const trimmed = explanation.trimStart();
  if (!trimmed.toLowerCase().startsWith(verdict.trim().toLowerCase())) {
    return explanation;
  }
  return trimmed.slice(verdict.trim().length).replace(/^[\s.:,-]+/, "");
}

function sumValue(assets: ResolvedAsset[]): number {
  return assets.reduce((total, asset) => total + asset.value, 0);
}

export function TradeVerdict({
  impact,
  myTeamLabel,
  theirTeamLabel,
}: {
  impact: TradeImpact;
  myTeamLabel: string;
  theirTeamLabel: string;
}) {
  const mine = impact.mine;

  const impactTab = (
    <div className="space-y-4">
      {/* 1. REASONS. The primary surface.
          The wash sits on a wrapper rather than on the Panel because Panel owns
          its own background, and its bg-surface/50 is translucent enough for the
          gradient underneath to read through it. Doing it this way keeps the
          shared Panel untouched. */}
      <div className="relative">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-modal"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.14) 0%, transparent 58%), radial-gradient(ellipse at 100% 0%, rgba(34, 211, 238, 0.12) 0%, transparent 62%)",
          }}
        />
        <Panel
          id="trade-verdict-reasons"
          eyebrow="Reasons"
          title="What this trade does for you"
          helper="Every gain and every cost."
          headingLevel={3}
          className="!border-line-accent shadow-[0_0_70px_-45px_rgba(168,85,247,0.9)]"
        >
          <ReasonList
            reasons={impact.reasons}
            caveats={impact.caveats}
            headingId="trade-verdict-reasons-title"
          />
        </Panel>
      </div>

      {/* 2. PERFORMANCE. */}
      <Panel
        eyebrow="Wins"
        title="Before and after"
        helper={`${myTeamLabel}, rest of season.`}
        headingLevel={3}
      >
        <PerformanceBody impact={impact} teamName={myTeamLabel} />
      </Panel>

      {/* 3. FOR THEM. */}
      <Panel
        eyebrow="Their side"
        title={`What it does for ${theirTeamLabel}`}
        helper="Why they might say yes."
        headingLevel={3}
      >
        {/* Two renders of the same content rather than one <details> that CSS
            forces open. A closed <details> hides its children through the UA
            shadow DOM, which no stylesheet of ours can reliably override, so
            "open above md" cannot be done with a media query alone. The variant
            that is display:none is out of the accessibility tree entirely, so
            nothing is announced twice, and both variants are ordinary keyboard
            content at the width where they render. */}
        <details className="group md:hidden">
          {/* inline-flex kills the disclosure triangle in every engine, so the
              chevron puts one back. It is the only thing a sighted reader has
              to say this expands; a screen reader is already told, which is why
              the icon is hidden from one and not the other. */}
          <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan">
            <ChevronRight
              aria-hidden="true"
              className="h-3.5 w-3.5 shrink-0 motion-safe:transition-transform group-open:rotate-90"
            />
            Show their side
          </summary>
          <div className="mt-3">
            <TheirSide team={impact.theirs} gaps={impact.gaps} />
          </div>
        </details>
        <div className="hidden md:block">
          <TheirSide team={impact.theirs} gaps={impact.gaps} />
        </div>
      </Panel>

      <p className="px-1 text-[11px] leading-relaxed text-ink-subtle">
        Lineup and odds cover {impact.weeksConsidered}{" "}
        {impact.weeksConsidered === 1 ? "week" : "weeks"} left.
        {/* The lineup model is the one thing above that a reader cannot see the
            inputs for, so it says so once rather than per tile. */}
        {mine.weeksImproved + mine.weeksWorsened > 0 && (
          <>
            {" "}
            {mine.weeksImproved} get better, {mine.weeksWorsened} get worse.
          </>
        )}
      </p>
    </div>
  );

  const valueTab = (
    <div className="space-y-4">
      <Panel
        eyebrow="Value"
        title="What the assets are worth"
        helper={`${impact.formatDisplay} values from ${impact.sourceDisplay}.`}
        headingLevel={3}
      >
        <ValueBody impact={impact} />
      </Panel>

      <p className="px-1 text-[11px] leading-relaxed text-ink-subtle">
        {impact.formatDisplay} values from {impact.sourceDisplay}
        {impact.pickSourceDisplay
          ? `, pick values from ${impact.pickSourceDisplay}`
          : ""}
        .
      </p>
    </div>
  );

  return <VerdictTabs impact={impactTab} value={valueTab} />;
}

/* ------------------------------------------------------------------ */
/* Performance                                                         */
/* ------------------------------------------------------------------ */

function PerformanceBody({
  impact,
  teamName,
}: {
  impact: TradeImpact;
  teamName: string;
}) {
  const t = impact.mine;
  const { lineup: noLineup, simulation: noSim } = impact.gaps;

  return (
    <div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {noLineup ? (
          <GapTile label="Points a week" reason={GAP_COPY.lineup} />
        ) : (
          <BeforeAfterTile
            label="Points a week"
            before={t.lineupBefore}
            after={t.lineupAfter}
            digits={1}
            changeSuffix="a week"
            accent="cyan"
          />
        )}
        {noSim ? (
          <>
            <GapTile label="Wins" reason={GAP_COPY.simulation} />
            <GapTile label="Playoff odds" reason={GAP_COPY.simulation} />
            <GapTile label="Title odds" reason={GAP_COPY.simulation} />
          </>
        ) : (
          <>
            {/* Wins, not a win-loss record: the model carries projected wins and
                nothing that would let us name the losses without inventing a
                game count. */}
            <BeforeAfterTile
              label="Wins"
              before={t.projectedWinsBefore}
              after={t.projectedWinsAfter}
              digits={1}
              changeSuffix="wins"
              accent="ink"
            />
            <OddsTile
              label="Playoff odds"
              before={t.playoffOddsBefore}
              after={t.playoffOddsAfter}
              accent="cyan"
            />
            <OddsTile
              label="Title odds"
              before={t.titleOddsBefore}
              after={t.titleOddsAfter}
              accent="purple"
            />
          </>
        )}
      </dl>

      <div className="mt-4">
        {noLineup ? (
          <p className="text-sm leading-relaxed text-ink-muted">{GAP_COPY.lineup}</p>
        ) : (
          <ImpactWeeks weeks={t.weeks} teamName={teamName} />
        )}
      </div>
    </div>
  );
}

/**
 * One before-and-after figure.
 *
 * The visible value reads "41.2 to 45.5" and the line under it states the
 * change with its unit spelled out, so a reader who lands on the number without
 * the column heading still knows what it counts.
 */
function BeforeAfterTile({
  label,
  before,
  after,
  digits,
  changeSuffix,
  accent,
}: {
  label: string;
  before: number | null;
  after: number | null;
  digits: number;
  changeSuffix: string;
  accent: "cyan" | "purple" | "ink";
}) {
  if (before === null || after === null) {
    return <GapTile label={label} reason="Not computed yet." />;
  }
  const color =
    accent === "purple"
      ? "text-brand-purple"
      : accent === "cyan"
        ? "text-brand-cyan"
        : "text-ink";
  const delta = after - before;
  return (
    <div className="rounded-card border border-line bg-base/50 px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
        {label}
      </dt>
      {/* The change line lives INSIDE the dd. A div grouping inside a dl may
          contain dt and dd and nothing else, so a trailing p here is invalid
          and puts the whole group at risk of being dropped from the list
          structure a screen reader builds. Same shape as the tiles in
          components/league-schedule/team-season.tsx. */}
      <dd className={`mt-0.5 font-mono text-base font-bold tabular-nums ${color}`}>
        {before.toFixed(digits)} to {after.toFixed(digits)}
        <span className="mt-0.5 block font-mono text-[10px] font-normal leading-tight tabular-nums text-ink-muted">
          {fmtSigned(delta, digits)} {changeSuffix}
        </span>
      </dd>
    </div>
  );
}

/**
 * Odds, before and after.
 *
 * The change line does NOT read "+17%". The two figures above it are already
 * percentages, and a percentage under two percentages reads as "17% more
 * likely", which is a different and larger claim than "up 17 points of chance".
 * So the number keeps its sign and the words name what moved.
 */
function OddsTile({
  label,
  before,
  after,
  accent,
}: {
  label: string;
  before: number | null;
  after: number | null;
  accent: "cyan" | "purple" | "ink";
}) {
  if (before === null || after === null) {
    return <GapTile label={label} reason={GAP_COPY.simulation} />;
  }
  const color =
    accent === "purple"
      ? "text-brand-purple"
      : accent === "cyan"
        ? "text-brand-cyan"
        : "text-ink";
  const points = Math.round(after * 100) - Math.round(before * 100);
  return (
    <div className="rounded-card border border-line bg-base/50 px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
        {label}
      </dt>
      <dd className={`mt-0.5 font-mono text-base font-bold tabular-nums ${color}`}>
        {fmtOdds(before)} to {fmtOdds(after)}
        <span className="mt-0.5 block font-sans text-[10px] font-normal leading-tight text-ink-muted">
          {points === 0 ? (
            "no change"
          ) : (
            <>
              <span className="font-mono tabular-nums">{fmtSigned(points)}</span> on the
              odds
            </>
          )}
        </span>
      </dd>
    </div>
  );
}

/** A tile that says why it has nothing, rather than showing a zero. */
function GapTile({ label, reason }: { label: string; reason: string }) {
  return (
    <div className="rounded-card border border-line bg-base/50 px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
        {label}
      </dt>
      <dd className="mt-0.5 text-xs font-semibold text-ink-subtle">
        {UNAVAILABLE}
        <span className="mt-0.5 block text-[10px] font-normal leading-tight text-ink-subtle">
          {reason}
        </span>
      </dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Value                                                               */
/* ------------------------------------------------------------------ */

function ValueBody({ impact }: { impact: TradeImpact }) {
  const t = impact.mine;
  const valueIn = sumValue(t.incoming);
  const valueOut = sumValue(t.outgoing);
  const larger = Math.max(valueIn, valueOut);
  const gapPct =
    larger > 0 ? Math.round((Math.abs(valueIn - valueOut) / larger) * 100) : 0;

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        <AssetColumn title="You get" tone="in" assets={t.incoming} total={valueIn} />
        <AssetColumn title="You send" tone="out" assets={t.outgoing} total={valueOut} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <PlainTile label="Value in" value={fmtValue(valueIn)} accent="cyan" />
        <PlainTile label="Value out" value={fmtValue(valueOut)} accent="purple" />
        <PlainTile
          label="Gap"
          value={`${gapPct}%`}
          sub={
            valueIn === valueOut
              ? "Dead level"
              : valueIn > valueOut
                ? "Your way"
                : "Their way"
          }
        />
        {impact.gaps.picks ? (
          <GapTile label="Picks" reason={GAP_COPY.picks} />
        ) : (
          <PlainTile
            label="Picks"
            value={fmtSigned(t.pickCountDelta)}
            sub={
              t.pickCountDelta === 0
                ? "Same either way"
                : t.pickCountDelta > 0
                  ? "More than you had"
                  : "Fewer than you had"
            }
          />
        )}
      </dl>

      <p className="mt-3 text-sm leading-relaxed text-ink-muted">
        Your roster goes from {fmtValue(t.valueBefore)} to {fmtValue(t.valueAfter)}, a
        change of {fmtSigned(t.valueDelta)}.{" "}
        {/* ageDelta compares the two SIDES of the deal, not two states of the
            roster: it is the value-weighted age of what you receive against
            what you send, and it knows nothing about the other players you
            keep. Describing it as a roster figure claimed one swap could move
            a thirty-man average by years, which a reader can check and
            disbelieve. Wording matches lib/trade-impact/reasons.ts. */}
        {t.ageDelta === null
          ? "There are not enough birthdates here to compare the ages of the two sides."
          : Math.abs(t.ageDelta) < 0.05
            ? "The two sides are about the same age."
            : `What you get is ${Math.abs(t.ageDelta).toFixed(1)} years ${
                t.ageDelta < 0 ? "younger" : "older"
              } than what you send, weighted by value.`}
      </p>

      {impact.grade ? (
        <div className="mt-4 rounded-card border border-line-accent bg-base/50 p-3">
          <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-purple">
            Signal Check says
          </h4>
          <p className="mt-1.5 text-sm font-semibold text-ink">
            {impact.grade.verdictLabel}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-ink-muted">
            {stripVerdictPrefix(impact.grade.explanation, impact.grade.verdictLabel)}
          </p>
          <p className="mt-1.5 text-xs text-ink-muted">
            {[
              `Graded on FF Beacon values in ${impact.grade.formatDisplay}`,
              impact.grade.confidenceLabel,
              impact.grade.tradeShapeLabel,
            ]
              .filter(Boolean)
              .join(", ")}
            .
          </p>
        </div>
      ) : (
        <p className="mt-4 rounded-card border border-line bg-base/50 p-3 text-sm leading-relaxed text-ink-muted">
          Signal Check has no second opinion on this deal, so the values above are the
          only pricing shown.
        </p>
      )}
    </div>
  );
}

function PlainTile({
  label,
  value,
  sub,
  accent = "ink",
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "cyan" | "purple" | "ink";
}) {
  const color =
    accent === "purple"
      ? "text-brand-purple"
      : accent === "cyan"
        ? "text-brand-cyan"
        : "text-ink";
  return (
    <div className="rounded-card border border-line bg-base/50 px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
        {label}
      </dt>
      <dd className={`mt-0.5 font-mono text-base font-bold tabular-nums ${color}`}>
        {value}
        {sub && (
          <span className="mt-0.5 block font-sans text-[10px] font-normal leading-tight text-ink-subtle">
            {sub}
          </span>
        )}
      </dd>
    </div>
  );
}

/**
 * One side of the deal.
 *
 * Cyan for what arrives, purple for what leaves, so a glance separates the two
 * columns before a word is read. The heading still names the side, because a
 * tint is not a label and a reader hearing the page never sees it.
 */
function AssetColumn({
  title,
  tone,
  assets,
  total,
}: {
  title: string;
  tone: "in" | "out";
  assets: ResolvedAsset[];
  total: number;
}) {
  const Icon = tone === "in" ? ArrowDownLeft : ArrowUpRight;
  const incoming = tone === "in";
  return (
    <section
      aria-label={`${title}, ${assets.length} ${
        assets.length === 1 ? "asset" : "assets"
      }, worth ${fmtValue(total)} in total`}
      className={`rounded-card border p-3 ${
        incoming
          ? "border-brand-cyan/30 bg-brand-cyan/[0.04]"
          : "border-brand-purple/30 bg-brand-purple/[0.04]"
      }`}
    >
      <h4
        className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.16em] ${
          incoming ? "text-brand-cyan" : "text-brand-purple"
        }`}
      >
        <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        {title}
      </h4>
      {assets.length === 0 ? (
        <p className="mt-2.5 text-sm text-ink-muted">Nothing on this side yet.</p>
      ) : (
        <ul className="mt-2.5 space-y-2">
          {assets.map((asset) => (
            <li key={asset.kind === "player" ? asset.playerId : asset.key}>
              <AssetRow asset={asset} />
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2.5 border-t border-line pt-2 text-xs font-semibold text-ink-muted">
        Total {fmtValue(total)}
      </p>
    </section>
  );
}

/**
 * One asset, in its own container.
 *
 * Every figure the model holds rides along at both breakpoints: position and
 * team, trade value, the weekly projection when there is one, the age when there
 * is one, and whether the player is parked on IR or taxi and so cannot start.
 * On a phone these wrap onto a second line rather than being dropped, because
 * the numbers ARE the argument and the reader on a phone is the one most likely
 * to be making the decision in the moment.
 */
function AssetRow({ asset }: { asset: ResolvedAsset }) {
  const shell =
    "flex items-center gap-2.5 rounded-card border border-line bg-surface-elevated p-2";

  if (asset.kind === "pick") {
    return (
      <div className={shell}>
        <span
          aria-hidden="true"
          className={`flex h-10 w-10 shrink-0 items-center justify-center border border-brand-cyan/40 bg-brand-cyan/10 text-[11px] font-extrabold text-brand-cyan ${PLAYER_PHOTO_RADIUS}`}
        >
          {ordinal(asset.round)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-ink">{asset.label}</span>
          <span className="block text-xs text-ink-muted">
            Draft pick, value {fmtValue(asset.value)}
          </span>
        </span>
      </div>
    );
  }

  const detail = [asset.position, asset.team].filter(Boolean).join(", ");
  const figures = [
    `value ${fmtValue(asset.value)}`,
    asset.projPoints !== null ? `${asset.projPoints.toFixed(1)} pts/wk` : "no projection",
    asset.age !== null ? `age ${asset.age.toFixed(1)}` : null,
    asset.isInactive ? "cannot start, on IR or taxi" : null,
  ].filter(Boolean) as string[];

  return (
    <div className={shell}>
      {/* Decorative: the name is the text immediately beside it, and an alt
          repeating it would have a screen reader say it twice. */}
      <PlayerHeadshot
        sleeperId={asset.sleeperId}
        name=""
        size={40}
        className="shrink-0"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-ink">{asset.name}</span>
        <span className="block text-xs text-ink-muted">
          {detail ? `${detail}. ` : ""}
          {figures.join(", ")}
        </span>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* For them                                                            */
/* ------------------------------------------------------------------ */

/**
 * The other side, compressed to the three figures that decide whether they say
 * yes. Compressed, never omitted: an acceptance band with no visible reasoning
 * behind it is a number the reader has to take on trust.
 */
function TheirSide({ team, gaps }: { team: TeamImpact; gaps: ImpactGaps }) {
  return (
    <div>
      {team.statusLabel && (
        <p className="mb-3 inline-block rounded-full border border-line px-2.5 py-1 text-xs font-medium text-ink-muted">
          They read as a {team.statusLabel}
        </p>
      )}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <PlainTile
          label="Their value"
          value={fmtSigned(team.valueDelta)}
          sub={
            team.valueDelta === 0
              ? "No change"
              : team.valueDelta > 0
                ? "They gain"
                : "They give up"
          }
          accent="purple"
        />
        {gaps.lineup ? (
          <GapTile label="Their lineup" reason={GAP_COPY.lineup} />
        ) : (
          <PlainTile
            label="Their lineup"
            value={
              team.lineupDelta === null
                ? UNAVAILABLE
                : `${fmtSigned(team.lineupDelta, 1)}/wk`
            }
            sub="Points a week"
            accent="cyan"
          />
        )}
        {gaps.simulation ? (
          <GapTile label="Their playoff odds" reason={GAP_COPY.simulation} />
        ) : (
          <div className="rounded-card border border-line bg-base/50 px-3 py-2">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
              Their playoff odds
            </dt>
            <dd className="mt-0.5 font-mono text-base font-bold tabular-nums text-ink">
              {fmtOdds(team.playoffOddsBefore)} to {fmtOdds(team.playoffOddsAfter)}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
