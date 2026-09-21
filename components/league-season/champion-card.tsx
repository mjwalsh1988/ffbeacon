/**
 * The league champion, once one has been decided.
 *
 * It leads the overview for a finished league, above everything that used to
 * lead it, because every other panel on that page answers a question about a
 * season that is over and this one answers the only question left.
 *
 * TWO WAYS TO WIN, AND THE CARD SAYS WHICH. A bracket league's champion won a
 * championship match and the runner-up is named beside them. A chopped
 * league's champion outlasted everyone and there is no runner-up to name,
 * because nobody lost a final: the other teams went out one at a time. Those
 * are different achievements and the card does not word them alike.
 *
 * The trophy is decorative. The eyebrow, the heading and the sentence under
 * the name carry the meaning on their own.
 *
 * Server component: presentation over data the caller resolved.
 */

import { Trophy } from "lucide-react";
import { Panel } from "@/components/dashboard-panel";
import { SleeperAvatar } from "@/components/sleeper-avatar";
import type { ChampionSource } from "@/lib/league-season/phase";
import type { OutcomeTeam } from "@/lib/league-season/load";

export function ChampionCard({
  champion,
  runnerUp,
  source,
  season,
}: {
  champion: OutcomeTeam;
  /** Bracket leagues only, and only when the final named a loser. */
  runnerUp: OutcomeTeam | null;
  source: ChampionSource | null;
  season: number | null;
}) {
  const lastStanding = source === "last_standing";
  const record = `${champion.record.wins}-${champion.record.losses}${
    champion.record.ties > 0 ? `-${champion.record.ties}` : ""
  }`;

  return (
    <Panel
      eyebrow={season ? `${season} champion` : "Champion"}
      title={lastStanding ? "Last one standing" : "League champion"}
      bodyClassName="px-4 py-4 sm:px-5"
      glow
    >
      <div
        className="relative overflow-hidden rounded-card border border-brand-cyan/60 p-4 sm:p-5"
        style={{
          backgroundImage:
            "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.22) 0%, transparent 62%), radial-gradient(ellipse at 100% 100%, rgba(34, 211, 238, 0.20) 0%, transparent 62%)",
        }}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-0.5"
          style={{
            backgroundImage:
              "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
          }}
        />
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          <span
            aria-hidden="true"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-card border border-brand-cyan/50 bg-brand-cyan/10 text-brand-cyan sm:h-14 sm:w-14"
          >
            <Trophy className="h-6 w-6 sm:h-7 sm:w-7" />
          </span>
          {/* Decorative. The name is the next thing on the line, and
              ImageWithFallback treats an empty alt as exactly that; passing the
              name would announce it twice. Same as the ledger table. */}
          <SleeperAvatar
            avatarId={champion.avatarId}
            initial={champion.name.charAt(0)}
            title=""
            size={48}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xl font-extrabold tracking-tight text-ink sm:text-2xl">
              {champion.name}
            </p>
            {champion.ownerLabel && (
              <p className="truncate text-sm font-semibold text-brand-cyan">
                {champion.ownerLabel}
              </p>
            )}
            <p className="mt-0.5 text-xs text-ink-muted">
              {lastStanding
                ? "Outlasted the whole league"
                : `Won the championship at ${record}`}
              {champion.pointsFor !== null
                ? `, ${champion.pointsFor.toFixed(1)} points on the season`
                : ""}
              .
            </p>
          </div>
        </div>
      </div>

      {runnerUp && (
        <p className="mt-3 text-xs text-ink-muted">
          Runner-up: {runnerUp.name}
          {runnerUp.ownerLabel ? ` (${runnerUp.ownerLabel})` : ""}.
        </p>
      )}
    </Panel>
  );
}
