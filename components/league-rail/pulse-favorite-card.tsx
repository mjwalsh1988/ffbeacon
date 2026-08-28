/**
 * The League Overview rail's top card: who Power Pulse expects to win.
 *
 * "Who wins my league" is the question a reader arrives with, and the overview
 * answered it only by ranking rosters on trade value, which is a different
 * question (who owns the most). This names one team, states the odds behind
 * the claim, and hands the reader on to the page that makes the full case.
 *
 * IT IS A FINDING, NOT A NAVIGATION ENTRY, which is why it sits above
 * "Explore this league" rather than inside it.
 *
 * Renders nothing at all when the league has no Power Pulse rows yet. An empty
 * card is worse than no card, and the Power Pulse page itself carries the
 * honest reason (leagues.power_pulse_status).
 *
 * Server component: pure presentation over data resolved by the caller. Every
 * figure is paired with a word, so nothing here is carried by colour alone.
 */

import Link from "next/link";
import { ArrowRight, Trophy } from "lucide-react";
import { Panel } from "@/components/dashboard-panel";
import { SleeperAvatar } from "@/components/sleeper-avatar";
import type { PulseFavorite } from "@/lib/league-pulse-favorite";

/**
 * A fraction as a percentage.
 *
 * Below one percent it says so in words: "0%" reads as impossible, and a team
 * the simulation gave a title to at all is not impossible. Matches
 * components/power-pulse/projected-champion.tsx, so the rail and the page it
 * links to never round the same number two different ways.
 */
function pct(value: number | null): string | null {
  if (value === null) return null;
  const asPct = value * 100;
  if (asPct > 0 && asPct < 1) return "under 1%";
  return `${Math.round(asPct)}%`;
}

/** "9.4-4.6", or null when the simulation produced no record. */
function record(wins: number | null, losses: number | null): string | null {
  if (wins === null || losses === null) return null;
  return `${wins.toFixed(1)}-${losses.toFixed(1)}`;
}

/**
 * One figure in the two-up row under the headline. The label is always
 * rendered, so the number never has to be inferred from its position.
 */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-card border border-line bg-base/50 px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-sm font-semibold tabular-nums text-ink">{value}</dd>
    </div>
  );
}

export function PulseFavoriteCard({
  favorite,
  powerPulseHref,
}: {
  favorite: PulseFavorite;
  powerPulseHref: string;
}) {
  const title = pct(favorite.titleOdds);
  const playoff = pct(favorite.playoffOdds);
  const projected = record(favorite.projectedWins, favorite.projectedLosses);

  // The headline claim, stated once, in words. The percentage below it is the
  // evidence; this sentence is what the percentage means.
  const claim = title
    ? `Wins this league ${title} of the time across every simulated season.`
    : `Ranks first in this league on expected performance.`;

  const tieNote =
    favorite.tiedWith > 0
      ? ` Tied with ${favorite.tiedWith} other team${favorite.tiedWith === 1 ? "" : "s"}.`
      : "";

  const stats: Array<{ label: string; value: string }> = [];
  if (projected) stats.push({ label: "Projected", value: projected });
  if (playoff) stats.push({ label: "Playoffs", value: playoff });
  if (stats.length === 0) {
    stats.push({ label: "Pulse", value: String(Math.round(favorite.powerPulse)) });
  }

  return (
    <Panel eyebrow="Projected" title="Who wins this league" bodyClassName="px-4 py-4 sm:px-5">
      <div className="flex items-start gap-3">
        <span className="shrink-0">
          <SleeperAvatar avatarId={favorite.avatarId} title={favorite.label} size={40} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-purple">
            {/* Decorative: the words "Title favorite" beside it carry the
                meaning, so the icon adds recognition rather than information. */}
            <Trophy aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            Title favorite
          </p>
          <p className="mt-0.5 truncate text-sm font-semibold text-ink" title={favorite.label}>
            {favorite.label}
          </p>
          {/* The big number, right where the eye lands, with its own label
              beneath rather than beside it so a narrow rail never wraps the
              two apart. */}
          {title && (
            <p className="mt-1.5 flex items-baseline gap-1.5">
              <span
                className="text-2xl font-semibold tabular-nums leading-none text-transparent"
                style={{
                  backgroundImage: "linear-gradient(90deg, #A855F7 0%, #22D3EE 100%)",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                }}
              >
                {title}
              </span>
              <span className="text-[11px] font-medium text-ink-muted">to win it all</span>
            </p>
          )}
        </div>
      </div>

      <p className="mt-2.5 text-xs leading-relaxed text-ink-muted">
        {claim}
        {tieNote}
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-2">
        {stats.map((s) => (
          <Stat key={s.label} label={s.label} value={s.value} />
        ))}
      </dl>

      <Link
        href={powerPulseHref}
        className="mt-3 flex min-h-11 items-center gap-1.5 text-xs font-semibold text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        View the full Power Pulse
        <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      </Link>
    </Panel>
  );
}
