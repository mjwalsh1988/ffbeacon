import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  CircleDashed,
  CircleHelp,
  Info,
  MessageSquareText,
  ScanSearch,
  Target,
  Trophy,
  Users,
  Wrench,
} from "lucide-react";
import { PLAYER_PHOTO_RADIUS, PlayerHeadshot } from "@/components/player-headshot";
import { SignalCheckNote } from "@/components/trade-ideas/signal-check-note";
import {
  POSITION_BADGE,
  POSITION_BADGE_FALLBACK,
  normalizePositionColor,
} from "@/lib/on-the-clock/position-colors";
import {
  ACCEPTANCE_LABEL,
  TRADE_POSITION_LABEL,
  readTradePosition,
  type SuggestionAsset,
  type TradeSuggestion,
} from "@/lib/trade-finder/types";
import type { SuggestionGrade } from "@/lib/trade-finder-grade";

/**
 * One suggested trade, rendered.
 *
 * The card is built to be HEARD as much as read. A screen reader user should get
 * the deal, the two impact sentences, and the caveats in that order without
 * needing to navigate a table, which is why the headline is a real heading, the
 * two sides are lists rather than columns, and every number that appears as a
 * chip is also stated in the prose underneath it.
 *
 * WHY BOTH SIDES ALWAYS SHOW EVERY FIGURE
 *   A trade card that shows what you gain and hides what you give up is a sales
 *   pitch. Value, projected points, and age sit on every asset on both sides, at
 *   every breakpoint. On a phone the assets stack and the figures move onto a
 *   second line inside each row; nothing is dropped, because the numbers ARE the
 *   argument and a reader on a phone is the one most likely to be making the
 *   decision in the moment.
 *
 * Presentational only. It fetches nothing and holds no state, so both surfaces
 * (the league tab and the cross-league panel) render the identical card.
 */

function fmtValue(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function fmtSigned(value: number, digits = 0): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(digits)}`;
}

/** "+2.3 points a week", spelled out for the accessible name. */
function describeLineup(delta: number | null): string {
  if (delta === null) return "not available";
  if (Math.abs(delta) < 0.05) return "no change";
  return `${fmtSigned(delta, 1)} points a week`;
}

export function TradeFinderCard({
  suggestion,
  grade,
  sleeperLeagueId,
  searchedUsername,
  headingId,
  leagueLabel,
  showGrade = true,
  builderHref,
}: {
  suggestion: TradeSuggestion;
  grade: SuggestionGrade | null;
  sleeperLeagueId: string;
  searchedUsername: string | null;
  /** Ties the card's heading to the region that owns it. */
  headingId: string;
  /** Shown in the cross-league panel, where the league is not implied. */
  leagueLabel?: string | null;
  /**
   * Whether to print Signal Check's verdict on the card.
   *
   * False when the surface is going to render a full evaluation underneath,
   * whose Value tab carries the same grade. Defaults to true so the portfolio
   * panel and any other caller keeps it without having to know why.
   */
  showGrade?: boolean;
  /**
   * Where this exact deal opens in the trade builder.
   *
   * OPTIONAL, and it has to stay that way. The same card renders on the
   * cross-league portfolio panel, where a deal can come out of any of the
   * reader's leagues and there is no single league page to open it in. Omitted,
   * the control is simply not drawn, rather than the card growing a link that
   * goes somewhere wrong.
   */
  builderHref?: string | null;
}) {
  const teamHref = (() => {
    const qs = new URLSearchParams();
    if (searchedUsername) qs.set("username", searchedUsername);
    const s = qs.toString();
    return `/leagues/${sleeperLeagueId}/teams/${suggestion.counterparty.rosterId}${s ? `?${s}` : ""}`;
  })();

  return (
    // The deal is the point of the page, so it gets the treatment the site
    // reserves for its primary surfaces: an elevated panel, a beacon hairline
    // along the top edge, and a corner glow. Everything around it is flat by
    // comparison, which is what makes this read as the thing to look at.
    <article
      className="relative overflow-hidden rounded-modal border border-line-accent bg-surface/70 p-4 shadow-[0_0_70px_-45px_rgba(168,85,247,0.9)] sm:p-6"
      style={{
        backgroundImage:
          "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.14) 0%, transparent 58%), radial-gradient(ellipse at 100% 0%, rgba(34, 211, 238, 0.12) 0%, transparent 62%)",
      }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <AcceptanceBadge suggestion={suggestion} />
        {leagueLabel && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs font-medium text-ink-muted">
            <Trophy aria-hidden="true" className="h-3 w-3" />
            {leagueLabel}
          </span>
        )}
        {/* The status word alone, with the icon carrying the "them" and the
            accessible name saying it in full. "They are a Rebuilder" was five
            words in a row of chips, and the sentence version is the one that
            matters, which is the one a screen reader now gets. */}
        {suggestion.counterparty.statusLabel && (
          <span
            aria-label={`The other team reads as a ${suggestion.counterparty.statusLabel}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs font-medium text-ink-muted"
          >
            <Users aria-hidden="true" className="h-3 w-3" />
            <span aria-hidden="true">{suggestion.counterparty.statusLabel}</span>
          </span>
        )}
      </div>

      <h3
        id={headingId}
        className="mt-3 text-lg font-bold leading-snug tracking-tight text-ink sm:text-2xl"
      >
        {suggestion.headline}
      </h3>

      {/* teamName is already formatTeamLabel output, so it carries the handle
          when there is one to carry. The line used to append ownerHandle after
          it as well, which printed the same handle twice, and the word "Open"
          did the job an underlined team name in the brand colour already does. */}
      <p className="mt-1 text-sm text-ink-muted">
        <Link
          href={teamHref}
          aria-label={`Open ${suggestion.counterparty.teamName}`}
          className="font-semibold text-brand-cyan underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          {suggestion.counterparty.teamName}
        </Link>
      </p>

      {/* Why this deal is in front of you, before the deal itself.
          A reader who does not know why a suggestion was chosen reads the whole
          card as arbitrary, and on the cross-league panel it is the only thing
          that accounts for the league it came out of. Older bookmarks predate
          the field and simply do not render this block.

          A framed callout rather than a rule down the left. Between the headline
          and the two asset columns the bare quote read as a continuation of the
          sentence above it; boxed, it is plainly a note ABOUT the deal. The icon
          replaces the "Why this one:" lead-in, which was three words spent
          saying what the box already says. */}
      {suggestion.rationale && (
        <div className="mt-3 flex gap-2.5 rounded-card border border-brand-purple/30 bg-brand-purple/[0.06] p-3">
          <ScanSearch
            aria-hidden="true"
            className="mt-0.5 h-4 w-4 shrink-0 text-brand-purple"
          />
          <p className="text-sm leading-relaxed text-ink-muted">
            <span className="sr-only">Why this one: </span>
            {suggestion.rationale}
          </p>
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <AssetColumn
          title="You get"
          tone="in"
          assets={suggestion.incoming}
          total={suggestion.incoming.reduce((s, a) => s + a.value, 0)}
        />
        <AssetColumn
          title="You send"
          tone="out"
          assets={suggestion.outgoing}
          total={suggestion.outgoing.reduce((s, a) => s + a.value, 0)}
        />
      </div>

      {/* Straight under the pieces, because that is where the thought lands:
          the deal is nearly right and one player wants swapping.

          THE LABEL NAMES THE PAYOFF, not the destination. This card already
          carries the Signal Check verdict, the lineup change, the value, the age
          and the reasons. What is one press away is the rest of the same
          evaluation the builder renders: projected wins and playoff odds before
          and after, and the week by week strip against your real schedule. A
          button that said only "Open in builder" made that sound like a detour
          to a different tool rather than the way to finish reading this deal. */}
      {/* THE LABEL NAMES WHAT IS LEFT TO GAIN, and that changed.
          It used to read "Full impact and edit", because the full impact WAS
          one press away. The evaluation now renders under this card, so the
          only thing the builder still offers is changing a piece, and a button
          promising an impact the reader has already scrolled past is a button
          that wastes their press. */}
      {builderHref && (
        <Link
          href={builderHref}
          aria-label="Open this trade in the builder to change any piece"
          className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-card border border-line-accent bg-surface px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <Wrench aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
          <span aria-hidden="true">Change a piece</span>
        </Link>
      )}

      <h4 className="mt-5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.16em] text-brand-cyan">
        <Target aria-hidden="true" className="h-3.5 w-3.5" />
        What it does
      </h4>
      <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Readout
          label="Your lineup"
          value={
            suggestion.mine.lineupDelta === null
              ? "Not available"
              : `${fmtSigned(suggestion.mine.lineupDelta, 1)}/wk`
          }
          spoken={`Your starting lineup: ${describeLineup(suggestion.mine.lineupDelta)}`}
          positive={(suggestion.mine.lineupDelta ?? 0) > 0}
        />
        <Readout
          label="Your value"
          value={fmtSigned(suggestion.mine.valueDelta)}
          spoken={`Your trade value: ${fmtSigned(suggestion.mine.valueDelta)} points`}
          positive={suggestion.mine.valueDelta > 0}
        />
        <Readout
          label="Their lineup"
          value={
            suggestion.theirs.lineupDelta === null
              ? "Not available"
              : `${fmtSigned(suggestion.theirs.lineupDelta, 1)}/wk`
          }
          spoken={`Their starting lineup: ${describeLineup(suggestion.theirs.lineupDelta)}`}
          positive={(suggestion.theirs.lineupDelta ?? 0) > 0}
        />
        <Readout
          label="Value gap"
          value={`${Math.round(suggestion.valueGap * 100)}%`}
          spoken={`Value gap between the two sides: ${Math.round(suggestion.valueGap * 100)} percent`}
          positive={suggestion.valueGap <= 0.06}
        />
      </dl>

      <p className="mt-4 text-sm leading-relaxed text-ink">{suggestion.whyYou}</p>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">{suggestion.whyThem}</p>

      {/* Dropped when a full evaluation is going to render under this card,
          because its Value tab owns the grade there and printing the same
          verdict in both places is the redundancy `stripVerdictPrefix` exists to
          avoid, one level up. The decision is made from the caller's own props
          rather than from whether the evaluation has arrived yet, so the block
          does not vanish out of a card the reader is already reading. */}
      {grade && showGrade && (
        <div className="mt-4">
          <SignalCheckNote grade={grade} />
        </div>
      )}

      {suggestion.caveats.length > 0 && (
        <div className="mt-4 rounded-card border border-line bg-base/40 p-3">
          <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.16em] text-ink-muted">
            <Info aria-hidden="true" className="h-3.5 w-3.5" />
            Worth knowing
          </h4>
          <ul className="mt-1.5 space-y-1">
            {suggestion.caveats.map((caveat) => (
              <li key={caveat} className="text-sm leading-relaxed text-ink-muted">
                {caveat}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Collapsed, so it costs one line until somebody wants it. It is here
          because the clipboard can be blocked, and without it a reader who
          cannot copy has no way to reach the message at all. */}
      <details className="mt-4 border-t border-line pt-3">
        <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-xs font-bold uppercase tracking-[0.16em] text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan">
          <MessageSquareText aria-hidden="true" className="h-3.5 w-3.5" />
          The message
        </summary>
        <p className="mt-1.5 whitespace-pre-line rounded-card border border-line bg-base/50 p-3 text-sm leading-relaxed text-ink-muted">
          {suggestion.pitch}
        </p>
      </details>
    </article>
  );
}

/**
 * How likely the other manager is to engage.
 *
 * A band with a reason attached rather than a percentage, because a percentage
 * about a person we have never met is a number we made up. Colour is never the
 * only signal: the band's word is the label, and the reason is in the accessible
 * description underneath it.
 */
function AcceptanceBadge({ suggestion }: { suggestion: TradeSuggestion }) {
  const likely = suggestion.acceptance === "likely";
  const worthAsking = suggestion.acceptance === "worth-asking";
  const tone = likely
    ? "border-signal-success/50 bg-signal-success/10 text-signal-success"
    : worthAsking
      ? "border-brand-cyan/50 bg-brand-cyan/10 text-brand-cyan"
      : "border-line text-ink-muted";
  // A third signal beside the word and the hue, so the three bands are told
  // apart with no colour perception at all: a filled check for the one they
  // probably take, an open circle for the one worth asking, a dashed one for a
  // long shot.
  const Icon = likely ? CheckCircle2 : worthAsking ? CircleHelp : CircleDashed;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${tone}`}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
      {ACCEPTANCE_LABEL[suggestion.acceptance]}
    </span>
  );
}

function AssetColumn({
  title,
  tone,
  assets,
  total,
}: {
  title: string;
  tone: "in" | "out";
  assets: SuggestionAsset[];
  total: number;
}) {
  const Icon = tone === "in" ? ArrowDownLeft : ArrowUpRight;
  const incoming = tone === "in";
  return (
    // The two sides are tinted apart, cyan for what arrives and purple for what
    // leaves, so a glance tells you which column is which before any word is
    // read. The heading still says it, because a tint is not a label.
    <section
      aria-label={`${title}, ${assets.length} ${assets.length === 1 ? "asset" : "assets"}, worth ${fmtValue(total)} in total`}
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
        <Icon aria-hidden="true" className="h-3.5 w-3.5" />
        {title}
      </h4>
      <ul className="mt-2.5 space-y-2">
        {assets.map((asset) => (
          <li key={asset.kind === "player" ? asset.playerId : asset.key}>
            <AssetRow asset={asset} />
          </li>
        ))}
      </ul>
      <p className="mt-2.5 border-t border-line pt-2 text-xs font-semibold text-ink-muted">
        Total value {fmtValue(total)}
      </p>
    </section>
  );
}

/**
 * One asset, in its own container.
 *
 * Each player and pick is a card of its own rather than a row in a list, because
 * a trade is a set of discrete things and running them together makes a
 * three-for-one read as a paragraph. The surface is raised above the column
 * tint so the pieces separate without another border colour.
 *
 * Every figure we hold rides along at both breakpoints: position and team, trade
 * value, the weekly projection when there is one, and the age when there is one.
 * On a phone these wrap onto a second line rather than being dropped.
 */
function AssetRow({ asset }: { asset: SuggestionAsset }) {
  const shell =
    "flex items-center gap-2.5 rounded-card border border-line bg-surface-elevated p-2";

  if (asset.kind === "pick") {
    return (
      <div className={shell}>
        <span
          aria-hidden="true"
          className={`flex h-10 w-10 shrink-0 items-center justify-center border border-brand-cyan/40 bg-brand-cyan/10 text-[11px] font-extrabold text-brand-cyan ${PLAYER_PHOTO_RADIUS}`}
        >
          {asset.round === 1 ? "1st" : asset.round === 2 ? "2nd" : `${asset.round}th`}
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

  const colorKey = normalizePositionColor(asset.position);
  // Spoken in full. Several screen readers spell "RB" out one letter at a time,
  // and a position group is the thing this card is most likely to have been
  // filtered on, so it is the last abbreviation that should arrive as letters.
  const position = readTradePosition(asset.position);
  const spokenPosition = position ? TRADE_POSITION_LABEL[position] : asset.position;
  const figures = [
    `value ${fmtValue(asset.value)}`,
    asset.projPoints !== null ? `${asset.projPoints.toFixed(1)} pts/wk` : null,
    asset.age !== null ? `age ${asset.age.toFixed(1)}` : null,
  ].filter(Boolean) as string[];

  return (
    <div className={shell}>
      {/* The component supplies its own shape and border, so nothing here needs
          to restate either. Decorative, because the name is the text immediately
          beside it and an alt repeating it would have a screen reader say it
          twice. */}
      <PlayerHeadshot sleeperId={asset.sleeperId} name="" size={40} className="shrink-0" />
      <span className="min-w-0 flex-1">
        {/* The position moved out of the detail line and onto the name, in the
            shared position hue (lib/on-the-clock/position-colors). A card
            produced by a position filter has to make the position findable at a
            glance, and it was previously the first word of a grey run-on
            beginning "RB, PHI. value 6,412, 14.2 pts/wk, age 24.1".

            aria-hidden, and the position is restated in the detail line's
            visually hidden text, so a screen reader hears the name followed by
            "Running back, PHI" rather than an abbreviation spelled out
            mid-sentence. */}
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-bold text-ink">{asset.name}</span>
          {asset.position && (
            <span
              aria-hidden="true"
              className={`rounded-md px-1.5 py-0.5 text-[10px] font-extrabold tracking-[0.1em] ${
                colorKey ? POSITION_BADGE[colorKey] : POSITION_BADGE_FALLBACK
              }`}
            >
              {asset.position}
            </span>
          )}
        </span>
        <span className="block text-xs text-ink-muted">
          <span className="sr-only">
            {[spokenPosition, asset.team].filter(Boolean).join(", ")}.{" "}
          </span>
          <span aria-hidden="true">{asset.team ? `${asset.team}. ` : ""}</span>
          {figures.join(", ")}
        </span>
      </span>
    </div>
  );
}

/**
 * One impact figure.
 *
 * The visible text is compact ("+2.3/wk") and what gets spoken is not ("Your
 * starting lineup: +2.3 points a week"). A unit a sighted reader infers from the
 * label above the number has to be said out loud for a reader who arrives at the
 * number on its own.
 *
 * THE SPOKEN TEXT IS A REAL ELEMENT, NOT AN aria-label. The first version put
 * aria-label on the <dd>, which does not reliably work: a dd maps to the
 * `definition` role, and naming from the author is not supported there, so
 * several screen readers ignore the attribute and read the raw "+2.3/wk"
 * instead. A visually hidden span always wins, because it is text.
 *
 * The visible figure is then aria-hidden, so the number is announced once rather
 * than twice.
 */
function Readout({
  label,
  value,
  spoken,
  positive,
}: {
  label: string;
  value: string;
  spoken: string;
  positive: boolean;
}) {
  return (
    <div className="rounded-card border border-line bg-base/40 px-2.5 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
        {label}
      </dt>
      <dd
        className={`mt-0.5 text-sm font-bold tabular-nums ${
          positive ? "text-signal-success" : "text-ink"
        }`}
      >
        <span className="sr-only">{spoken}</span>
        <span aria-hidden="true">{value}</span>
      </dd>
    </div>
  );
}
