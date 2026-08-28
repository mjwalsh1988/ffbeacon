"use client";

/**
 * Everything the league knows about this trade that the value grade does not.
 *
 * Three blocks, each independent, each of which simply does not render when its
 * data does not exist for this league:
 *
 *   PER PLAYER   Positional WAR in THIS league (wins over replacement, and the
 *                player's rank against the number of that position the league
 *                actually starts), his projected points a week, and his
 *                thirty-day value movement.
 *
 *   PER TEAM     Where each of the two teams stands right now: Power Pulse
 *                score and rank, projected record, playoff and title odds, and
 *                its rank by trade value beside its rank by expected wins.
 *
 *   NOTHING ELSE. No re-simulation of the trade, no counterfactual, no "what
 *                 this did to their season". Those players have already moved
 *                 on, some of them twice, so a simulation of the trade being
 *                 undone would be a story rather than a measurement. Every
 *                 number on this panel is one a reader could go and check.
 *
 * WAR IS THE POSITIONAL METRIC, AND IT SAYS SO. The token only ever appears as
 * "Positional WAR" here, never on its own and never attached to a team, per the
 * naming rule in lib/positional-war/types.ts. The team block talks about
 * projected wins, which is a different quantity, and the two never share a
 * column.
 *
 * Nobody is named. The teams are Team A and Team B.
 */

import { Activity, LineChart, TrendingDown, TrendingUp, Users2 } from "lucide-react";
import { PlayerHeadshot } from "@/components/player-headshot";
import type {
  WyrAsset,
  WyrReview,
  WyrSide,
  WyrTeamNote,
} from "@/lib/would-you-rather/types";
import { SIDE_LABEL } from "./trade-board";

export function DeepRead({
  review,
  assetsBySide,
}: {
  review: WyrReview;
  assetsBySide: Record<WyrSide, WyrAsset[]>;
}) {
  // Side is carried with each asset rather than recovered by identity later:
  // an asset's key already encodes it, and reaching back into the arrays to ask
  // which one an object came from is both slower and easy to get wrong.
  const allAssets: Array<{ asset: WyrAsset; side: WyrSide }> = [
    ...assetsBySide.a.map((asset) => ({ asset, side: "a" as WyrSide })),
    ...assetsBySide.b.map((asset) => ({ asset, side: "b" as WyrSide })),
  ];
  const withContext = allAssets.filter(
    ({ asset }) => review.war[asset.key] || review.trends[asset.key],
  );

  const hasPlayers = withContext.length > 0;
  const hasTeams = review.teams !== null && review.teams.length === 2;

  // Read off the server's own answer rather than inferred from which players
  // happened to match. Inferring it made two false claims: a league that HAS
  // curves but starts neither of these players deep enough to carry them was
  // told it had none, and so was a reader whose admin had simply switched the
  // block off.
  const warBlockShown = review.leagueHasWarCurves !== null;
  const leagueHasWar = review.leagueHasWarCurves === true;

  if (!hasPlayers && !hasTeams) {
    return (
      <p className="text-sm leading-relaxed text-ink-muted">
        There is nothing this league can add beyond the grade above. Its
        Positional WAR curves and its Power Pulse standings are built the first
        time somebody opens it in League Pulse, and neither exists yet.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {hasPlayers && (
        <section aria-labelledby="wyr-players-heading">
          <h3
            id="wyr-players-heading"
            className="flex items-center gap-1.5 text-sm font-semibold text-ink"
          >
            <LineChart aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
            Every player in the deal, in this league
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-subtle">
            Positional WAR is wins over replacement at that position in this
            league's own lineup rules. It says nothing about either roster: a
            player worth a lot at his position can still add almost nothing to a
            team that already starts somebody better.
          </p>
          {warBlockShown && !leagueHasWar && (
            <p className="mt-2 rounded-card border border-line bg-base/40 px-3 py-2.5 text-xs leading-relaxed text-ink-muted">
              This league has no Positional WAR curves yet, so there is no
              wins-over-replacement figure for anybody in this trade. They are
              built the first time somebody opens the league in League Pulse, and
              never on a schedule.
            </p>
          )}
          <ul role="list" className="mt-3 space-y-2.5">
            {withContext.map(({ asset, side }) => (
              <PlayerRow
                key={asset.key}
                asset={asset}
                side={side}
                war={review.war[asset.key] ?? null}
                trend={review.trends[asset.key] ?? null}
                leagueHasWar={leagueHasWar}
              />
            ))}
          </ul>
        </section>
      )}

      {hasTeams && (
        <section aria-labelledby="wyr-teams-heading">
          <h3
            id="wyr-teams-heading"
            className="flex items-center gap-1.5 text-sm font-semibold text-ink"
          >
            <Users2 aria-hidden="true" className="h-4 w-4 text-brand-cyan" />
            Where the two teams stand now
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-subtle">
            Power Pulse is how many games a team should win from here, ranked
            inside its own league. These are today's standings, not the day of
            the trade, so they say what kind of team made the deal rather than
            what the deal did.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {review.teams!.map((team) => (
              <TeamCard key={team.side} team={team} isYours={team.side === review.yourSide} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ---------- One player ---------- */

function PlayerRow({
  asset,
  side,
  war,
  trend,
  leagueHasWar,
}: {
  asset: WyrAsset;
  side: WyrSide;
  war: WyrReview["war"][string] | null;
  trend: WyrReview["trends"][string] | null;
  /** False when the whole league has no curves, which the section says once. */
  leagueHasWar: boolean;
}) {
  return (
    <li className="rounded-card border border-line bg-base/40 p-3">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="inline-flex shrink-0">
          <PlayerHeadshot sleeperId={asset.sleeperId} name="" size={40} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-sm font-semibold text-ink">{asset.name}</span>
            <span className="text-xs text-ink-subtle">to {SIDE_LABEL[side]}</span>
            {war?.injuryStatus && (
              <span className="rounded-full border border-signal-warning/50 bg-signal-warning/10 px-2 py-0.5 text-[11px] font-medium text-signal-warning">
                {war.injuryStatus}
              </span>
            )}
          </p>

          {war && (
            <>
              {/* The sentence first, then the figures. A reader who takes only
                  the sentence has the whole finding; the figures are for the
                  reader who wants to check it. */}
              <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
                {war.war.toFixed(2)} wins over replacement. {war.position}
                {war.positionRank} of the {war.structuralDemand} this league
                starts at his position.
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
                <Figure label="Positional WAR" value={war.war.toFixed(2)} />
                <Figure
                  label="Projected"
                  value={`${war.projectedPointsPerWeek.toFixed(1)} pts/wk`}
                />
                <Figure
                  label="Replacement"
                  value={`${war.replacementPointsPerWeek.toFixed(1)} pts/wk`}
                />
                <Figure
                  label="Above replacement"
                  value={`${war.pointsAboveReplacement.toFixed(0)} pts`}
                  hint={`over ${war.weeksProjected} projected week${war.weeksProjected === 1 ? "" : "s"}`}
                />
              </dl>
            </>
          )}

          {trend && <TrendLine trend={trend} />}

          {/* Only when the league HAS curves and this player is not on one,
              which is a real finding: he sits past the depth this league starts
              at his position. When the league has no curves, the section above
              has already said so once. */}
          {!war && leagueHasWar && (
            <p className="mt-1.5 text-xs leading-relaxed text-ink-subtle">
              He is past the depth this league starts at his position, so he sits
              off the Positional WAR curve entirely.
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

function TrendLine({ trend }: { trend: NonNullable<WyrReview["trends"][string]> }) {
  const change = trend.change30d;
  const hasChange = change !== null && change !== 0;
  const up = (change ?? 0) > 0;
  const Icon = up ? TrendingUp : TrendingDown;

  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {trend.value !== null && (
        <span className="text-ink-muted">
          Value <span className="font-mono tabular-nums text-ink">{trend.value.toLocaleString()}</span>
        </span>
      )}
      {hasChange ? (
        <span
          className={`inline-flex items-center gap-1 ${up ? "text-signal-success" : "text-signal-danger"}`}
        >
          <Icon aria-hidden="true" className="h-3.5 w-3.5" />
          <span className="font-mono tabular-nums">
            {up ? "+" : ""}
            {change!.toLocaleString()}
          </span>
          <span className="text-ink-subtle">over 30 days</span>
        </span>
      ) : (
        // Not a zero. player_value_trends says outright when there is not enough
        // history behind the window, and an absence is printed as an absence.
        <span className="text-ink-subtle">Not enough history for a 30-day move</span>
      )}
      {trend.overallRank !== null && (
        <span className="text-ink-muted">
          Ranked <span className="font-mono tabular-nums text-ink">#{trend.overallRank}</span>{" "}
          overall
        </span>
      )}
    </p>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
        {label}
      </dt>
      <dd className="font-mono text-sm font-semibold tabular-nums text-ink">{value}</dd>
      {hint && <dd className="text-[11px] text-ink-subtle">{hint}</dd>}
    </div>
  );
}

/* ---------- One team ---------- */

function TeamCard({ team, isYours }: { team: WyrTeamNote; isYours: boolean }) {
  const label = SIDE_LABEL[team.side];
  const record = team.record
    ? `${team.record.wins}-${team.record.losses}${team.record.ties > 0 ? `-${team.record.ties}` : ""}`
    : null;

  return (
    <section
      aria-labelledby={`wyr-team-${team.side}`}
      className={`rounded-card border p-4 ${
        isYours ? "border-brand-cyan/50 bg-brand-cyan/[0.05]" : "border-line bg-base/40"
      }`}
    >
      <h4
        id={`wyr-team-${team.side}`}
        className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm font-semibold text-ink"
      >
        {label}
        {isYours && (
          <span className="rounded-full bg-brand-cyan/15 px-2 py-0.5 text-[11px] font-semibold text-brand-cyan">
            your pick
          </span>
        )}
        {team.statusLabel && (
          <span className="rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-ink-muted">
            {team.statusLabel}
          </span>
        )}
      </h4>

      {record && <p className="mt-1 text-xs text-ink-subtle">Record {record}</p>}

      <div className="mt-3 flex items-baseline gap-2">
        <Activity aria-hidden="true" className="h-4 w-4 shrink-0 text-brand-purple" />
        <p className="font-mono text-2xl font-bold tabular-nums text-ink">
          {team.powerPulse ?? "N/A"}
        </p>
        <p className="text-xs text-ink-subtle">
          Power Pulse
          {team.pulseRank !== null ? `, ${ordinal(team.pulseRank)} of ${team.teamCount}` : ""}
        </p>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
        <Figure
          label="Projected record"
          value={
            team.projectedWins !== null && team.projectedLosses !== null
              ? `${team.projectedWins.toFixed(1)}-${team.projectedLosses.toFixed(1)}`
              : "N/A"
          }
        />
        <Figure label="Playoff odds" value={pct(team.playoffOdds)} />
        <Figure label="Title odds" value={pct(team.titleOdds)} />
        <Figure
          label="Rank by value"
          value={team.valueRank !== null ? `${ordinal(team.valueRank)} of ${team.teamCount}` : "N/A"}
        />
      </dl>

      {team.statusReason && (
        <p className="mt-2.5 text-xs leading-relaxed text-ink-subtle">{team.statusReason}</p>
      )}
    </section>
  );
}

function pct(value: number | null): string {
  if (value === null) return "N/A";
  const percent = value * 100;
  // A rounded 0% on a team with a real, tiny chance reads as elimination. Below
  // half a percent it is written as an inequality instead.
  if (percent > 0 && percent < 0.5) return "<1%";
  if (percent < 100 && percent > 99.5) return ">99%";
  return `${Math.round(percent)}%`;
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
