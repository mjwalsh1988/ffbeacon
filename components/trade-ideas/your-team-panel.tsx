import { Panel } from "@/components/dashboard-panel";
// Shared, so there is one ordinal in the codebase rather than a copy per
// feature quietly disagreeing about 3 and 13.
import { ordinal } from "@/components/league-schedule/format";

/**
 * Where your team stands right now, in the rail beside the evaluation.
 *
 * WHY THIS EXISTS
 *   "Adds 4.3 points a week" is a number without a scale. Next to "projected 6.4
 *   wins, 8th of 12" it becomes a decision. This panel is the reference point
 *   the reasons are measured against, which is why it sits on the same screen
 *   rather than a tab away.
 *
 * WHY EVERY MISSING FIGURE SAYS SO
 *   A rail full of dashes teaches a reader to distrust the whole surface, and a
 *   zero where a null belongs is worse: it is a number we invented. Each tile
 *   that has nothing to show says "Not available" in words, so the absence is
 *   readable and unmistakable when it is spoken aloud.
 *
 * The rail is 340px on the widest layout, so the tiles pair up two across and
 * every label is short enough to survive that width without wrapping oddly.
 *
 * Server component: presentational, no state.
 */

const UNAVAILABLE = "Not available";

function Tile({
  label,
  value,
  sub,
  accent = "ink",
}: {
  label: string;
  value: string;
  sub?: string | null;
  accent?: "cyan" | "purple" | "ink";
}) {
  const missing = value === UNAVAILABLE;
  const color = missing
    ? "text-ink-subtle"
    : accent === "purple"
      ? "text-brand-purple"
      : accent === "cyan"
        ? "text-brand-cyan"
        : "text-ink";
  return (
    <div className="rounded-card border border-line bg-base/50 px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
        {label}
      </dt>
      {/* Missing figures drop out of the mono/tabular treatment because they are
          a sentence, not a measurement. The sub-line sits inside the dd rather
          than after it: a div grouping inside a dl may hold dt and dd and
          nothing else, and a trailing p risks the whole group falling out of
          the definition list a screen reader builds. */}
      <dd
        className={`mt-0.5 font-bold ${color} ${
          missing ? "text-xs font-medium" : "font-mono text-base tabular-nums"
        }`}
      >
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

export function YourTeamPanel({
  teamName,
  pulseRank,
  pulseScore,
  teamCount,
  statusLabel,
  projectedWins,
  projectedLosses,
  playoffOdds,
  valueRank,
  weakestSlot,
}: {
  teamName: string;
  pulseRank: number | null;
  pulseScore: number | null;
  teamCount: number;
  statusLabel: string | null;
  projectedWins: number | null;
  projectedLosses: number | null;
  playoffOdds: number | null;
  valueRank: number | null;
  weakestSlot: { label: string; points: number } | null;
}) {
  const record =
    projectedWins === null || projectedLosses === null
      ? UNAVAILABLE
      : `${projectedWins.toFixed(1)}-${projectedLosses.toFixed(1)}`;

  return (
    <Panel
      eyebrow="Your team"
      title={teamName}
      helper={statusLabel ? `This team reads as a ${statusLabel}.` : undefined}
    >
      <dl className="grid grid-cols-2 gap-2">
        <Tile
          label="Power Pulse"
          value={pulseScore === null ? UNAVAILABLE : String(pulseScore)}
          sub={
            pulseRank === null
              ? "No ranking yet"
              : `${ordinal(pulseRank)} of ${teamCount}`
          }
          accent="cyan"
        />
        <Tile
          label="Value rank"
          value={valueRank === null ? UNAVAILABLE : ordinal(valueRank)}
          sub={valueRank === null ? "No rankings yet" : `of ${teamCount} teams`}
          accent="purple"
        />
        <Tile label="Projected record" value={record} sub="Wins and losses" />
        <Tile
          label="Playoff odds"
          value={playoffOdds === null ? UNAVAILABLE : `${Math.round(playoffOdds * 100)}%`}
          sub="From here on"
          accent="cyan"
        />
        <div className="col-span-2 rounded-card border border-line bg-base/50 px-3 py-2">
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
            Weakest starting slot
          </dt>
          <dd className="mt-0.5 text-sm font-semibold text-ink">
            {weakestSlot === null ? (
              <span className="text-xs font-medium text-ink-subtle">{UNAVAILABLE}</span>
            ) : (
              <>
                {weakestSlot.label}{" "}
                <span className="font-mono text-xs font-normal tabular-nums text-ink-muted">
                  {weakestSlot.points.toFixed(1)} pts per week
                </span>
              </>
            )}
          </dd>
        </div>
      </dl>
    </Panel>
  );
}
