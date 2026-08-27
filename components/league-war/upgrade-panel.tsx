"use client";

import { useState, useTransition } from "react";
import { Panel } from "@/components/dashboard-panel";
import { ChartEmpty } from "@/components/chart-kit";
import { PULSE_POSITIONS, type PulsePosition } from "@/lib/power-pulse/types";
import { requestUpgradeWhatIf } from "@/app/leagues/[league_id]/positional-war/actions";
import type { UpgradeWhatIfOutcome } from "@/lib/positional-war/upgrade";

/**
 * The upgrade what-if panel (T-WAR-48, section 15.1.2).
 *
 * Client component, mounted on /leagues/[id]/positional-war below the chart,
 * and NOWHERE else: it is deliberately absent from the Overview and the Power
 * Pulse page, which render on every visit. Every value this component needs
 * to decide whether to show its controls at all (whether a viewer roster
 * resolved, whether Power Pulse has a baseline) is resolved server-side by
 * the page BEFORE this component mounts, so mounting it never itself costs a
 * read. The simulation only ever runs from the one button below, through the
 * server action in the sibling actions.ts, never during any render.
 *
 * NAMING. This is the one place in the product where both Positional WAR (the
 * league-wide, player-independent figure) and projected wins (the
 * team-specific figure this panel exists to compute) are required to appear
 * together. lib/positional-war/naming.test.ts allowlists this file for that
 * reason. The two are always two separately labelled blocks, never merged
 * into one figure and never sharing a column, because making the gap between
 * them legible is the entire point of the panel.
 */

const POSITION_LABEL: Record<PulsePosition, string> = {
  QB: "Quarterback",
  RB: "Running back",
  WR: "Wide receiver",
  TE: "Tight end",
  K: "Kicker",
  DEF: "Team defense",
};

/**
 * Matches the return shape of lib/positional-war/upgrade.ts
 * resolveUpgradePanelAvailability. "no-viewer" is carried in the type for
 * that reason even though the page never mounts this component without a
 * viewer roster already resolved (case 1 is handled by not mounting at all),
 * so the disabled render below treats both reasons identically.
 */
export type UpgradePanelAvailability = { ok: true } | { ok: false; reason: "no-viewer" | "no-baseline" };

export function UpgradeWhatIfPanel({
  sleeperLeagueId,
  viewerRosterId,
  searchedUsername,
  focusedRosterId,
  availability,
}: {
  sleeperLeagueId: string;
  /** Already resolved server-side. The page never mounts this without one. */
  viewerRosterId: number;
  searchedUsername: string | null;
  focusedRosterId: number | null;
  /** Resolved server-side (T-WAR-48 case 2: Power Pulse has no cached rows yet). */
  availability: UpgradePanelAvailability;
}) {
  const [position, setPosition] = useState<PulsePosition>("QB");
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<UpgradeWhatIfOutcome | null>(null);

  const disabled = !availability.ok;

  const run = () => {
    setOutcome(null);
    startTransition(async () => {
      const result = await requestUpgradeWhatIf({
        sleeperLeagueId,
        position,
        submittedRosterId: viewerRosterId,
        searchedUsername,
        focusedRosterId,
      });
      setOutcome(result);
    });
  };

  return (
    <Panel
      id="positional-war-upgrade"
      title="Try an upgrade"
      eyebrow="What it would do to you"
      headingFocusable
      helper="Add the best player at a position you do not already own, and see what it does to your season."
    >
      {disabled ? (
        <ChartEmpty>Team projections are still calculating.</ChartEmpty>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
            <div className="flex-1 sm:max-w-xs">
              <label
                htmlFor="upgrade-position"
                className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted"
              >
                Position
              </label>
              <select
                id="upgrade-position"
                value={position}
                onChange={(event) => {
                  setPosition(event.target.value as PulsePosition);
                  setOutcome(null);
                }}
                disabled={pending}
                className="min-h-11 w-full rounded-card border border-line bg-base/60 px-3 py-2 text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
              >
                {PULSE_POSITIONS.map((pos) => (
                  <option key={pos} value={pos}>
                    {POSITION_LABEL[pos]}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={run}
              disabled={pending}
              className="min-h-11 min-w-11 rounded-card bg-brand-cyan/15 px-4 py-2 text-sm font-semibold text-brand-cyan transition-colors hover:bg-brand-cyan/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan disabled:opacity-50"
            >
              {pending ? "Checking" : `Check ${POSITION_LABEL[position].toLowerCase()}`}
            </button>
          </div>

          <div role="status" aria-live="polite" className="mt-4 min-h-[1.5rem] text-sm leading-relaxed text-ink-muted">
            {pending && <p>Rebuilding your lineup and playing out the season.</p>}
            {!pending && outcome && <OutcomeReadout outcome={outcome} />}
          </div>
        </>
      )}
    </Panel>
  );
}

function refusalMessage(reason: Exclude<UpgradeWhatIfOutcome, { ok: true }>["reason"]): string {
  switch (reason) {
    case "rate-limited":
      return "Too many checks in the last minute. Try again shortly.";
    case "no-season-left":
      return "This league has no regular season games left.";
    case "no-baseline":
      return "Team projections are still calculating.";
    case "no-candidates":
      return "Every ranked player at this position is already yours, or has no projection.";
    case "no-viewer":
    case "roster-mismatch":
      return "We could not confirm which team is yours in this league.";
    case "invalid":
    case "league-not-found":
    default:
      return "That check could not be run. Try again.";
  }
}

/** A signed figure. Zero prints as +0.0 rather than -0.0. */
function signed(value: number, digits: number): string {
  const rounded = Math.abs(value) < 5 * 10 ** -(digits + 1) ? 0 : value;
  const text = rounded.toFixed(digits);
  return rounded > 0 ? `+${text}` : rounded === 0 ? `+${text}` : text;
}

function OutcomeReadout({ outcome }: { outcome: UpgradeWhatIfOutcome }) {
  if (!outcome.ok) {
    return <p>{refusalMessage(outcome.reason)}</p>;
  }

  const { result } = outcome;
  const target = result.target;
  const winsText = result.winsDelta !== null ? `${signed(result.winsDelta, 1)} projected wins` : null;
  const playoffText =
    result.playoffOddsDeltaPoints !== null
      ? `${signed(result.playoffOddsDeltaPoints, 1)} percentage points of playoff odds`
      : null;
  const becauseClause = result.droppedPlayerName
    ? `, because you would cut ${result.droppedPlayerName}`
    : "";

  return (
    <div className="space-y-3">
      {result.fellBackFrom && (
        <p className="text-xs text-ink-subtle">
          You already hold {result.position}
          {result.fellBackFrom.positionRank}, so this uses {result.position}
          {target.positionRank}.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-card border border-line bg-base/40 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
            Positional WAR (league-wide)
          </p>
          <p className="mt-1 text-lg font-semibold text-ink">{target.positionalWar.toFixed(2)}</p>
          <p className="mt-1 text-xs text-ink-muted">
            {target.name}, {result.position}
            {target.positionRank}
            {target.team ? `, ${target.team}` : ""}
          </p>
        </div>
        <div className="rounded-card border border-line bg-base/40 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">For your team</p>
          <p className="mt-1 text-lg font-semibold text-ink">{winsText ?? "Not available"}</p>
          {/* Rendered only when there is a figure. A non-breaking space to
              reserve the line height would put a character with no meaning
              into the accessibility tree, and the grid already holds the two
              blocks level without it. */}
          {playoffText && <p className="mt-1 text-xs text-ink-muted">{playoffText}</p>}
        </div>
      </div>

      <p>
        {winsText
          ? `Adding ${target.name} is worth ${winsText} to your team${becauseClause}.`
          : `We could not work out what ${target.name} would be worth to your team.`}
      </p>
    </div>
  );
}
