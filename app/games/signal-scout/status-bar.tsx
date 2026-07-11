"use client";

/**
 * Signal Scout status bar: the always-visible "mission readout" once a round
 * exists (or, before one exists, the idle/guest context). Presentational
 * only, built on the shared Panel + StatReadout shells from
 * components/dashboard-panel.tsx so it matches the rest of the site's
 * cockpit-style stat rows.
 */

import { Panel, StatReadout } from "@/components/dashboard-panel";

export interface SignalScoutStatusBarProps {
  score: number | null;
  signalStreak: number;
  dailyStreak: number;
  wrongGuesses: number;
  maxWrongGuesses: number;
  burned: boolean;
  isAuthenticated: boolean;
  guestRoundsRemaining: number | null;
}

export function SignalScoutStatusBar({
  score,
  signalStreak,
  dailyStreak,
  wrongGuesses,
  maxWrongGuesses,
  burned,
  isAuthenticated,
  guestRoundsRemaining,
}: SignalScoutStatusBarProps) {
  const showGuestTile = guestRoundsRemaining !== null;

  return (
    <Panel id="signal-scout-status" eyebrow="Signal status" title="Mission readout" headingLevel={3}>
      <dl
        aria-label="Game status"
        className={`grid grid-cols-2 gap-2 sm:grid-cols-3 ${showGuestTile ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}
      >
        <ScoreTile score={score} burned={burned} />
        <StatReadout label="Signal Streak" value={String(signalStreak)} accent="purple" />
        <StatReadout label="Daily Scout Streak" value={String(dailyStreak)} accent="cyan" />
        <BadReadsTile wrongGuesses={wrongGuesses} maxWrongGuesses={maxWrongGuesses} />
        {showGuestTile && (
          <StatReadout label="Guest rounds left" value={String(guestRoundsRemaining)} accent="ink" />
        )}
      </dl>
      {!isAuthenticated && (
        <p className="mt-3 text-xs text-ink-subtle">
          Guest streaks last for this visit only. Create a free account to save them and climb the leaderboards.
        </p>
      )}
    </Panel>
  );
}

function ScoreTile({ score, burned }: { score: number | null; burned: boolean }) {
  return (
    <div className="rounded-card border border-line bg-base/50 px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
        {burned ? "Score, burned out" : "Score"}
      </dt>
      {burned ? (
        <dd className="mt-0.5 font-mono text-lg font-bold tabular-nums text-signal-danger">0</dd>
      ) : score === null ? (
        <dd className="mt-0.5 font-mono text-lg font-bold tabular-nums text-ink-muted">--</dd>
      ) : (
        <dd
          className="mt-0.5 bg-clip-text font-mono text-lg font-bold tabular-nums text-transparent"
          style={{ backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)" }}
        >
          {score.toLocaleString("en-US")}
        </dd>
      )}
    </div>
  );
}

function BadReadsTile({
  wrongGuesses,
  maxWrongGuesses,
}: {
  wrongGuesses: number;
  maxWrongGuesses: number;
}) {
  const pips = Array.from({ length: maxWrongGuesses }, (_, i) => i < wrongGuesses);
  return (
    <div className="rounded-card border border-line bg-base/50 px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">Bad Reads</dt>
      <dd className="mt-0.5 flex items-center gap-2">
        <span className="flex items-center gap-1">
          {pips.map((used, i) => (
            <span
              key={i}
              aria-hidden="true"
              className={`h-2.5 w-2.5 rounded-full ${used ? "bg-signal-danger" : "bg-line"}`}
            />
          ))}
        </span>
        <span className="font-mono text-sm font-semibold tabular-nums text-ink">
          {wrongGuesses} of {maxWrongGuesses}
        </span>
      </dd>
    </div>
  );
}
