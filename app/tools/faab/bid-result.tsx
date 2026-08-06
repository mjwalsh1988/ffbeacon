"use client";

import {
  ArrowDownRight,
  ArrowUpRight,
  CircleDollarSign,
  Info,
  Minus,
  ShieldAlert,
  Target,
  TrendingUp,
} from "lucide-react";
import type {
  BidLadder,
  FaabConfidence,
  FaabSignal,
  LeagueFaabReport,
  MarginalValue,
  MarginalWeek,
  MarketRead,
} from "@/lib/faab/types";

/**
 * The recommendation, for either mode.
 *
 * Both the connected-league answer and the manual one render through here so
 * the two never drift into looking like different products. What changes
 * between them is what the figures MEAN, not how they are laid out: league mode
 * measures against your actual lineup, manual mode against the best player you
 * could already start. The mode is stated on the card rather than left implied.
 *
 * Everything is text first. Screen readers get the same three numbers, the same
 * reasoning, and the same per-week detail, and nothing is hidden at any
 * breakpoint: the week strip wraps rather than disappearing.
 */

export type BidView = {
  mode: "league" | "manual";
  title: string;
  /** Sits under the title: the league name, or the format and league shape. */
  subtitle: string;
  headline: string;
  explanation: string;
  confidence: FaabConfidence;
  ladder: BidLadder;
  isDumpCandidate: boolean;
  marginal: MarginalValue | null;
  signals: FaabSignal[];
  /** Null in manual mode: without a league there is no competition to read. */
  market: MarketRead | null;
  notices: string[];
  /** Manual mode only: the player replacement level was measured against. */
  replacement: { rank: number; pointsPerWeek: number } | null;
  availability?: LeagueFaabReport["availability"];
  rosteredBy?: string | null;
};

const CONFIDENCE_LABEL: Record<FaabConfidence, string> = {
  high: "Strong read",
  medium: "Reasonable read",
  low: "Thin read",
};

/** Build the view from a connected-league report. */
export function viewFromLeagueReport(report: LeagueFaabReport): BidView {
  return {
    mode: "league",
    title: report.player.name,
    subtitle: `${report.league.name}, week ${report.league.currentWeek}`,
    headline: report.headline,
    explanation: report.explanation,
    confidence: report.confidence,
    ladder: report.ladder,
    isDumpCandidate: report.isDumpCandidate,
    marginal: report.marginal,
    signals: report.signals,
    market: report.market,
    notices: report.notices,
    replacement: null,
    availability: report.availability,
    rosteredBy: report.rosteredBy,
  };
}

export function BidResult({ view }: { view: BidView }) {
  const benchOnly = view.marginal?.isBenchOnly ?? false;

  return (
    <div className="space-y-4">
      <div
        className={`relative overflow-hidden rounded-modal border p-5 ${
          view.isDumpCandidate
            ? "border-brand-purple/40 bg-brand-purple/5"
            : benchOnly
              ? "border-line bg-base/40"
              : "border-brand-cyan/30 bg-brand-cyan/5"
        }`}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full"
          style={{
            background: view.isDumpCandidate
              ? "radial-gradient(circle, rgba(168,85,247,0.20) 0%, rgba(34,211,238,0.06) 50%, transparent 75%)"
              : "radial-gradient(circle, rgba(34,211,238,0.18) 0%, rgba(168,85,247,0.06) 50%, transparent 75%)",
          }}
        />
        <div className="relative">
          <p className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-brand-cyan">
            <Target className="h-3.5 w-3.5" aria-hidden="true" />
            {view.headline}
            <span className="rounded-full border border-line px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-ink-subtle">
              {CONFIDENCE_LABEL[view.confidence]}
            </span>
          </p>

          <h4 className="mt-2 text-base font-semibold text-ink">
            {view.title}
            <span className="ml-2 font-normal text-ink-subtle">{view.subtitle}</span>
          </h4>

          <Ladder ladder={view.ladder} />

          <p className="mt-4 text-sm leading-relaxed text-ink">{view.explanation}</p>
        </div>
      </div>

      {view.marginal && !benchOnly && <ImpactGrid view={view} />}
      {view.marginal && view.marginal.weeks.length > 0 && (
        <WeekStrip weeks={view.marginal.weeks} mode={view.mode} />
      )}

      <SignalList signals={view.signals} />
      {view.market && <MarketCard view={view} market={view.market} />}

      {view.notices.map((note, i) => (
        <p
          key={i}
          className="rounded-card border border-dashed border-line bg-surface/40 px-4 py-3 text-sm leading-relaxed text-ink-muted"
        >
          {note}
        </p>
      ))}
    </div>
  );
}

/**
 * Three rungs, in decision order. The walk-away number carries as much weight
 * as the recommendation because the expensive FAAB mistake is winning an
 * auction you should have lost.
 */
function Ladder({ ladder }: { ladder: BidLadder }) {
  const rungs = [
    {
      key: "likely",
      label: "Bid this",
      value: ladder.likely,
      hint: `${ladder.likelyPct}% of budget, leaves ${ladder.budgetAfterLikely}.`,
      strong: true,
    },
    {
      key: "aggressive",
      label: "To be sure",
      value: ladder.aggressive,
      hint: "Buys confidence, costs flexibility.",
      strong: false,
    },
    {
      key: "walkaway",
      label: "Walk away above",
      value: ladder.walkAway,
      hint: "Past this you are overpaying.",
      strong: false,
    },
  ];

  return (
    <dl className="mt-4 grid gap-3 sm:grid-cols-3">
      {rungs.map((rung) => (
        <div
          key={rung.key}
          className={`rounded-card border p-3 ${
            rung.strong ? "border-brand-cyan/40 bg-base/60" : "border-line bg-base/40"
          }`}
        >
          <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-subtle">
            {rung.label}
          </dt>
          <dd>
            <span
              className={`mt-1 block font-mono font-bold tabular-nums ${
                rung.strong
                  ? "bg-clip-text text-2xl text-transparent forced-colors:text-ink sm:text-3xl"
                  : "text-xl text-ink"
              }`}
              style={
                rung.strong
                  ? { backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)" }
                  : undefined
              }
            >
              {rung.value} FAAB
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-ink-subtle">
              {rung.hint}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The measured impact, as figures rather than adjectives. */
function ImpactGrid({ view }: { view: BidView }) {
  const m = view.marginal;
  if (!m) return null;

  const cells: Array<{ label: string; value: string; spoken: string }> = [
    {
      label: "Points a week",
      value: `+${m.netPointsPerWeek.toFixed(1)}`,
      spoken:
        view.mode === "league"
          ? `Adds ${m.netPointsPerWeek.toFixed(1)} points a week to your starting lineup`
          : `Adds ${m.netPointsPerWeek.toFixed(1)} points a week over a replacement-level starter`,
    },
  ];

  if (view.mode === "league") {
    cells.push({
      label: "Weeks he starts",
      value: `${m.weeksStarting} of ${m.weeksConsidered}`,
      spoken: `Starts for you in ${m.weeksStarting} of your ${m.weeksConsidered} remaining weeks`,
    });
    if (m.expectedWinsAdded !== null) {
      cells.push({
        label: "Wins added",
        value: `+${m.expectedWinsAdded.toFixed(1)}`,
        spoken: `Worth about ${m.expectedWinsAdded.toFixed(1)} extra wins`,
      });
    }
    if (m.playoffOddsBefore !== null && m.playoffOddsAfter !== null) {
      cells.push({
        label: "Playoff odds",
        value: `${m.playoffOddsBefore.toFixed(0)}% to ${m.playoffOddsAfter.toFixed(0)}%`,
        spoken: `Playoff odds move from ${m.playoffOddsBefore.toFixed(0)} percent to ${m.playoffOddsAfter.toFixed(0)} percent`,
      });
    }
  } else {
    cells.push({
      label: "Weeks left",
      value: String(m.weeksConsidered),
      spoken: `${m.weeksConsidered} regular season weeks left`,
    });
    if (view.replacement) {
      cells.push({
        label: "Replacement level",
        value: `${view.replacement.pointsPerWeek.toFixed(1)} a week`,
        spoken: `The last startable player at his position projects ${view.replacement.pointsPerWeek.toFixed(1)} points a week`,
      });
      cells.push({
        label: "Startable at",
        value: `#${view.replacement.rank}`,
        spoken: `Your league runs about ${view.replacement.rank} startable players at his position`,
      });
    }
  }

  return (
    <section
      aria-label={view.mode === "league" ? "What he adds to your team" : "What he adds"}
      className="rounded-card border border-line bg-surface/40 p-4"
    >
      <h5 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <TrendingUp aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
        {view.mode === "league" ? "What he adds to your team" : "What he adds over replacement"}
      </h5>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cells.map((cell) => (
          <div key={cell.label} className="rounded-card border border-line bg-base/50 p-3">
            <dt className="text-xs text-ink-subtle">{cell.label}</dt>
            <dd className="mt-1 font-mono text-sm font-bold tabular-nums text-ink">
              <span aria-hidden="true">{cell.value}</span>
              <span className="sr-only">{cell.spoken}</span>
            </dd>
          </div>
        ))}
      </dl>
      {m.dropCost && (
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          You would drop <strong className="text-ink">{m.dropCost.name}</strong>
          {m.dropCost.pointsPerWeek > 0.1
            ? `, costing ${m.dropCost.pointsPerWeek.toFixed(1)} a week. Figures above are net of that.`
            : ", who costs you nothing."}
        </p>
      )}
    </section>
  );
}

/** How hard a matchup reads, for the manual week strip. */
function matchupWord(multiplier: number): string {
  if (multiplier >= 1.08) return "good";
  if (multiplier <= 0.92) return "tough";
  return "even";
}

/**
 * Week by week. A wrapping list rather than a table so nothing is dropped on a
 * phone, and every entry carries its own sentence, because "W7 +4.2" read aloud
 * is not one.
 */
function WeekStrip({ weeks, mode }: { weeks: MarginalWeek[]; mode: BidView["mode"] }) {
  return (
    <section
      aria-label="Week by week"
      className="rounded-card border border-line bg-surface/40 p-4"
    >
      <h5 className="text-sm font-semibold text-ink">
        {mode === "league" ? "Week by week" : "His remaining schedule"}
      </h5>
      <ul role="list" className="mt-3 flex flex-wrap gap-2">
        {weeks.map((week) => {
          const good =
            mode === "league" ? week.startsForYou : week.opponentMultiplier >= 1.08;
          const tough = mode === "manual" && week.opponentMultiplier <= 0.92;
          return (
            <li
              key={week.week}
              className={`inline-flex min-h-11 min-w-[4.5rem] flex-col justify-center rounded-card border px-3 py-1.5 ${
                good
                  ? "border-brand-cyan/40 bg-brand-cyan/10"
                  : tough
                    ? "border-signal-danger/40 bg-signal-danger/5"
                    : "border-line bg-base/50"
              }`}
            >
              <span aria-hidden="true" className="text-[11px] font-semibold text-ink-subtle">
                Wk {week.week}
                {week.opponent ? ` vs ${week.opponent}` : ""}
              </span>
              <span
                aria-hidden="true"
                className={`font-mono text-xs font-bold tabular-nums ${
                  good ? "text-brand-cyan" : tough ? "text-signal-danger" : "text-ink-subtle"
                }`}
              >
                {mode === "league"
                  ? week.startsForYou
                    ? `+${week.pointsAdded.toFixed(1)}`
                    : "bench"
                  : matchupWord(week.opponentMultiplier)}
              </span>
              <span className="sr-only">
                {mode === "league"
                  ? week.startsForYou
                    ? `Week ${week.week}${week.opponent ? ` against ${week.opponent}` : ""}: starts, adds ${week.pointsAdded.toFixed(1)} points.`
                    : `Week ${week.week}${week.opponent ? ` against ${week.opponent}` : ""}: does not crack your lineup.`
                  : `Week ${week.week}${week.opponent ? ` against ${week.opponent}` : ""}: ${matchupWord(week.opponentMultiplier)} matchup.`}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function toneIcon(tone: FaabSignal["tone"]) {
  if (tone === "good") return ArrowUpRight;
  if (tone === "bad") return ArrowDownRight;
  return Minus;
}

function toneClass(tone: FaabSignal["tone"]): string {
  if (tone === "good") return "text-signal-success";
  if (tone === "bad") return "text-signal-danger";
  return "text-ink-subtle";
}

/** Every reason the number moved, so a reader can disagree with it. */
function SignalList({ signals }: { signals: FaabSignal[] }) {
  if (signals.length === 0) return null;

  return (
    <section
      aria-label="Why this number"
      className="rounded-card border border-line bg-surface/40 p-4"
    >
      <h5 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Info aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
        Why this number
      </h5>
      <ul role="list" className="mt-3 space-y-3">
        {signals.map((signal) => {
          const Icon = toneIcon(signal.tone);
          const movePct = Math.round((signal.multiplier - 1) * 100);
          return (
            <li key={signal.id} className="flex items-start gap-2.5">
              <Icon
                aria-hidden="true"
                className={`mt-0.5 h-4 w-4 shrink-0 ${toneClass(signal.tone)}`}
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">
                  {signal.label}
                  {movePct !== 0 && (
                    <span className={`ml-2 font-mono text-xs ${toneClass(signal.tone)}`}>
                      {movePct > 0 ? "+" : ""}
                      {movePct}%
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-sm leading-relaxed text-ink-muted">
                  {signal.detail}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The competition, spelled out. League mode only. */
function MarketCard({ view, market }: { view: BidView; market: MarketRead }) {
  const lines: string[] = [];

  lines.push(
    market.richestRivalBudget !== null
      ? `You have ${market.yourBudget} FAAB; the richest rival has ${market.richestRivalBudget}.`
      : `You have ${market.yourBudget} FAAB left.`,
  );

  if (market.interestedRivals !== null && market.rivalsChecked !== null) {
    lines.push(
      market.interestedRivals === 0
        ? `None of the other ${market.rivalsChecked} rosters would start him.`
        : `${market.interestedRivals} of ${market.rivalsChecked} rosters would start him.`,
    );
  }

  if (market.comparable) {
    lines.push(
      `Winning bids here run ${market.comparable.p25} to ${market.comparable.p75}, median ${market.comparable.median}, over ${market.comparable.sampleSize} claims.`,
    );
  }

  lines.push(`${market.weeksLeft} regular season week${market.weeksLeft === 1 ? "" : "s"} left.`);

  return (
    <section
      aria-label="Who else is bidding"
      className="rounded-card border border-line bg-surface/40 p-4"
    >
      <h5 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <CircleDollarSign aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
        Who else is bidding
      </h5>
      <ul role="list" className="mt-2 space-y-1.5">
        {lines.map((line, i) => (
          <li key={i} className="text-sm leading-relaxed text-ink-muted">
            {line}
          </li>
        ))}
      </ul>
      {view.availability === "rostered" && (
        <p className="mt-3 flex items-start gap-2 text-sm text-ink">
          <ShieldAlert
            aria-hidden="true"
            className="mt-0.5 h-4 w-4 shrink-0 text-signal-danger"
          />
          <span>
            {view.rosteredBy} already has him here, so this is what he would be worth to you
            rather than what you can bid.
          </span>
        </p>
      )}
    </section>
  );
}
