/**
 * One player on the waiver board, as a card in a grid.
 *
 * WHY A GRID OF CARDS RATHER THAN A STACK OF FULL-WIDTH ROWS. The board used to
 * be one column of wide rows, and at desktop width that is a very long page of
 * very empty lines: forty characters of content stretched across twelve hundred
 * pixels, forty times. Two cards abreast halve the scroll, put twice as much on
 * screen at once, and give each player a frame the eye can take in as a unit.
 *
 * WHY IT IS STILL A CARD AND NOT A TABLE. Every figure here matters to the
 * decision, and a five-column numeric table would put every one of them behind
 * `hidden md:table-cell` on a phone, which CLAUDE.md forbids outright. The card
 * stacks the same figures at 360px and lays them out two-up from lg. Nothing is
 * dropped at any width.
 *
 * NOTHING VISIBLE IS aria-hidden. Each figure is one text node whose missing
 * words are appended as `sr-only` INSIDE THE SAME ELEMENT, the way the Lineups
 * board does it. Drawing a number twice (a hidden span for the eye, a visually
 * hidden twin for the ear) reads correctly line by line and goes silent the
 * moment a pointer lands on it, because a screen reader following the pointer
 * finds a hidden object and falls back to an ancestor. `aria-hidden` survives
 * on the headshot (decorative, the name is beside it), the team logo (same),
 * the availability bar (the percentage is beside it) and the hairline.
 *
 * THE PLAYER NAME IS THE ONLY LINK. A card full of links is a card a keyboard
 * reader has to tab through five times to pass. The name goes to the player
 * profile, which is where every other figure on the card can be chased.
 *
 * Presentational server component.
 */

import { OFFENSE_POSITIONS, positionNounMap, type IdpPosition } from "@/lib/site";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { POSITION_BADGE } from "@/lib/on-the-clock/position-colors";
import { PlayerHeadshot } from "@/components/player-headshot";
import { NflTeamLogo } from "@/components/nfl-team-logo";
import type { BoardPosition, BoardRow } from "@/lib/waiver-wire/types";

/**
 * The four positions that touch the ball.
 *
 * A kicker has no targets and a team defense has no carries, so the usage cell
 * shows what they SCORED last week instead. Printing "0 touches" under the
 * Detroit Lions is a statistic that cannot exist, and a reader who sees a zero
 * has been told something false rather than nothing.
 */
const TOUCH_POSITIONS: readonly BoardPosition[] = ["QB", "RB", "WR", "TE"];

const POSITION_WORD: Record<BoardPosition, string> = positionNounMap(OFFENSE_POSITIONS, {
  short: ["DEF"],
});

/**
 * The rank tile's edge, one hue per position.
 *
 * Drawn from the SAME `position.*` palette as On The Clock rather than from
 * brand purple and cyan, and for the reason that palette exists: those two hues
 * are reserved for state across this product, so tinting a running back cyan
 * would make the colour read as a signal about the claim instead of a label for
 * the position.
 */
const POSITION_BORDER: Record<BoardPosition | IdpPosition, string> = {
  QB: "border-position-qb/40",
  RB: "border-position-rb/40",
  WR: "border-position-wr/40",
  TE: "border-position-te/40",
  K: "border-position-k/40",
  DEF: "border-position-def/40",
  DL: "border-position-dl/40",
  LB: "border-position-lb/40",
  DB: "border-position-db/40",
};

const POSITION_TEXT: Record<BoardPosition | IdpPosition, string> = {
  QB: "text-position-qb",
  RB: "text-position-rb",
  WR: "text-position-wr",
  TE: "text-position-te",
  K: "text-position-k",
  DEF: "text-position-def",
  DL: "text-position-dl",
  LB: "text-position-lb",
  DB: "text-position-db",
};

function one(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

function whole(n: number): string {
  return String(Math.round(n));
}

/**
 * One figure in the card's metric grid.
 *
 * `label` is visible; `srSuffix` carries the words a sighted reader gets from
 * the layout and a screen reader does not, inside the same element so the two
 * can never be read apart.
 */
function Metric({
  label,
  value,
  srSuffix,
  tone = "plain",
  detail,
}: {
  label: string;
  value: string;
  srSuffix?: string;
  tone?: "plain" | "cyan" | "muted";
  detail?: string;
}) {
  const valueTone =
    tone === "cyan" ? "text-brand-cyan" : tone === "muted" ? "text-ink-subtle" : "text-ink";
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-subtle">
        {label}
      </dt>
      <dd className={`mt-0.5 font-mono text-sm font-bold tabular-nums ${valueTone}`}>
        {value}
        {srSuffix && <span className="sr-only"> {srSuffix}</span>}
      </dd>
      {detail && (
        <p className="mt-0.5 truncate text-[11px] leading-tight text-ink-subtle">{detail}</p>
      )}
    </div>
  );
}

/** The touch-delta arrow. The sign is in the number too, so this is decoration. */
function DeltaIcon({ delta }: { delta: number }) {
  if (delta > 0.5) {
    return <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5 text-signal-success" />;
  }
  if (delta < -0.5) {
    return <ArrowDownRight aria-hidden="true" className="h-3.5 w-3.5 text-signal-danger" />;
  }
  return <Minus aria-hidden="true" className="h-3.5 w-3.5 text-ink-subtle" />;
}

/**
 * How widely he is gone, as a filled track.
 *
 * Decorative: the percentage sits in text immediately beside it, so the bar is
 * a second reading of a figure already stated rather than the only place it
 * appears. It exists because "12 percent" and "61 percent" take a beat to
 * compare as numerals and none at all as two bars.
 */
function AvailabilityBar({ pct }: { pct: number }) {
  return (
    <span
      aria-hidden="true"
      className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-line"
    >
      <span
        className="block h-full rounded-full"
        style={{
          width: `${Math.max(2, Math.min(100, pct))}%`,
          backgroundImage:
            pct < 25
              ? "linear-gradient(90deg, #22D3EE 0%, #A855F7 100%)"
              : "linear-gradient(90deg, #8A8A9C 0%, #8A8A9C 100%)",
        }}
      />
    </span>
  );
}

/** The recommended claim, priced for the board's stated standard league. */
export function BidPill({ bid }: { bid: NonNullable<BoardRow["bid"]> }) {
  if (bid.isDumpCandidate) {
    return (
      <div className="shrink-0 rounded-card border border-dashed border-line bg-base/40 px-2.5 py-1.5 text-right">
        <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-ink-subtle">Bid</p>
        <p className="font-mono text-sm font-bold text-ink-muted">
          $0
          <span className="sr-only"> to $1, he should clear waivers</span>
        </p>
      </div>
    );
  }
  return (
    <div
      className="shrink-0 rounded-card p-px"
      style={{ backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)" }}
    >
      <div className="rounded-card px-2.5 py-1.5 text-right" style={{ background: "#16162A" }}>
        <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-brand-cyan">Bid</p>
        <p className="font-mono text-sm font-bold tabular-nums text-ink">
          ${bid.lowPct}-{bid.highPct}
          <span className="sr-only">
            {" "}
            of a $100 budget, which is {bid.lowPct} to {bid.highPct} percent of whatever you
            have left, in a 12-team standard league. {bid.tierLabel}.
          </span>
        </p>
      </div>
    </div>
  );
}

export function WaiverPlayerCard({
  row,
  index,
  isPast,
}: {
  row: BoardRow;
  /** 1-based position within its group, for the rank tile. */
  index: number;
  /** True when the board's week has been played, which changes every tense. */
  isPast: boolean;
}) {
  const { opportunity: o, projection, rosterRate, bid } = row;
  const touches = TOUCH_POSITIONS.includes(row.position);

  return (
    <li className="min-w-0">
      <article
        aria-labelledby={`wire-${row.playerId}`}
        className="flex h-full min-w-0 flex-col rounded-card border border-line bg-surface/50 p-3.5 transition-colors hover:border-line-accent"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className={`relative shrink-0 rounded-md border ${POSITION_BORDER[row.position]}`}
          >
            <PlayerHeadshot sleeperId={row.sleeperId} name="" size={44} />
            <span
              className={`absolute -bottom-1.5 -right-1.5 rounded px-1 py-px font-mono text-[9px] font-bold ${POSITION_BADGE[row.position]}`}
            >
              {index}
            </span>
          </span>

          <div className="min-w-0 flex-1">
            <h4 id={`wire-${row.playerId}`} className="truncate text-[15px] font-semibold text-ink">
              <span className="sr-only">
                Number {index} at {POSITION_WORD[row.position]}:{" "}
              </span>
              <Link
                href={`/players/${row.slug}`}
                className="underline-offset-2 hover:text-brand-cyan hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                {row.name}
              </Link>
            </h4>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-ink-muted">
              <span className={POSITION_TEXT[row.position]}>{row.position}</span>
              <span className="sr-only">, {POSITION_WORD[row.position]}</span>
              {row.team && (
                <>
                  <NflTeamLogo team={row.team} size={14} />
                  <span>{row.team}</span>
                </>
              )}
              <span className="text-ink-subtle">
                {row.position}
                {row.positionRank}
              </span>
              <span className="sr-only">in this format</span>
            </p>
          </div>

          {bid && <BidPill bid={bid} />}
        </div>

        <div
          aria-hidden="true"
          className="mt-3 h-px w-full"
          style={{
            backgroundImage:
              "linear-gradient(90deg, rgba(34,211,238,0.3) 0%, rgba(42,42,71,0.6) 55%, transparent 100%)",
          }}
        />

        <dl className="mt-2.5 grid grid-cols-3 gap-x-3 gap-y-2">
          <div className="min-w-0">
            <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-subtle">
              Rostered
            </dt>
            <dd
              className={`mt-0.5 font-mono text-sm font-bold tabular-nums ${
                rosterRate?.pct != null && rosterRate.pct < 25 ? "text-brand-cyan" : "text-ink"
              }`}
            >
              {rosterRate?.pct == null ? "No data" : `${whole(rosterRate.pct)}%`}
              <span className="sr-only">
                {rosterRate?.pct == null
                  ? " for how widely he is rostered"
                  : ` of the ${rosterRate.total} leagues we track`}
              </span>
            </dd>
            {rosterRate?.pct != null && <AvailabilityBar pct={rosterRate.pct} />}
          </div>

          <Metric
            label={isPast ? "Projected" : "This week"}
            value={projection ? one(projection.points) : "None"}
            srSuffix={
              projection
                ? `points${projection.opponent ? `, against ${projection.opponent}` : ""}`
                : "projection published for this week"
            }
            detail={projection?.opponent ? `vs ${projection.opponent}` : "No opponent"}
          />

          {touches ? (
            <div className="min-w-0">
              <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-subtle">
                Touches
              </dt>
              <dd className="mt-0.5 flex items-center gap-1 font-mono text-sm font-bold tabular-nums text-ink">
                {o.lastTouches == null ? (
                  <span>
                    None
                    <span className="sr-only"> recorded this season</span>
                  </span>
                ) : (
                  <>
                    {o.touchDelta != null && <DeltaIcon delta={o.touchDelta} />}
                    <span>
                      {whole(o.lastTouches)}
                      <span className="sr-only">
                        {" "}
                        touches in week {o.lastWeek}
                        {o.touchDelta != null
                          ? `, ${o.touchDelta > 0 ? "up" : o.touchDelta < 0 ? "down" : "level"} on his ${one(o.priorTouches ?? 0)} average`
                          : ""}
                      </span>
                    </span>
                    {o.touchDelta != null && o.touchDelta !== 0 && (
                      <span
                        className={`text-[11px] font-semibold ${
                          o.touchDelta > 0 ? "text-signal-success" : "text-signal-danger"
                        }`}
                      >
                        {o.touchDelta > 0 ? "+" : ""}
                        {one(o.touchDelta)}
                      </span>
                    )}
                  </>
                )}
              </dd>
              <p className="mt-0.5 truncate text-[11px] leading-tight text-ink-subtle">
                {o.lastWeek == null ? "No games" : `Week ${o.lastWeek}`}
              </p>
            </div>
          ) : (
            <Metric
              label="Last week"
              value={o.lastPoints == null ? "Did not play" : one(o.lastPoints)}
              srSuffix={
                o.lastPoints == null
                  ? "in a week we hold a line for"
                  : `points scored in week ${o.lastWeek}`
              }
              detail={o.lastWeek == null ? "No games" : `Scored, week ${o.lastWeek}`}
            />
          )}
        </dl>

        <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">{row.reason}</p>
      </article>
    </li>
  );
}
