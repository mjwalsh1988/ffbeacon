import type { HardestEasiestRow, CountRow } from "./insights";

interface PlayerLabel {
  name: string;
  position: string;
}

interface DisplayRow {
  playerId: string;
  value: string;
}

const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle";
const td = "px-3 py-2 text-sm text-ink";

function playerLabel(playerNames: Map<string, PlayerLabel>, playerId: string): PlayerLabel {
  return playerNames.get(playerId) ?? { name: "Unknown player", position: "" };
}

function winRateRows(rows: HardestEasiestRow[]): DisplayRow[] {
  return rows.map((r) => ({
    playerId: r.playerId,
    value: `${Math.round(r.winRate * 100)}% (${r.wins}/${r.rounds})`,
  }));
}

function countRows(rows: CountRow[]): DisplayRow[] {
  return rows.map((r) => ({ playerId: r.playerId, value: String(r.count) }));
}

function MiniTable({
  id,
  title,
  caption,
  emptyText,
  columnLabel,
  rows,
  playerNames,
}: {
  id: string;
  title: string;
  caption: string;
  emptyText: string;
  columnLabel: string;
  rows: DisplayRow[];
  playerNames: Map<string, PlayerLabel>;
}) {
  return (
    <div>
      <h3 id={id} className="text-sm font-semibold text-ink">
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="mt-2 rounded-card border border-line bg-surface/40 p-3 text-xs text-ink-muted">
          {emptyText}
        </p>
      ) : (
        <div
          tabIndex={0}
          role="region"
          aria-labelledby={id}
          className="mt-2 overflow-x-auto rounded-card border border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <table className="w-full min-w-[280px] border-collapse text-sm">
            <caption className="sr-only">{caption}</caption>
            <thead className="bg-surface/60">
              <tr>
                <th scope="col" className={th}>
                  Rank
                </th>
                <th scope="col" className={th}>
                  Player
                </th>
                <th scope="col" className={th}>
                  {columnLabel}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const label = playerLabel(playerNames, row.playerId);
                return (
                  <tr key={row.playerId} className="border-t border-line/60">
                    <th scope="row" className={`${td} font-normal text-ink-muted`}>
                      {index + 1}
                    </th>
                    <td className={td}>
                      {label.name}
                      {label.position ? (
                        <span className="ml-1.5 text-xs text-ink-subtle">{label.position}</span>
                      ) : null}
                    </td>
                    <td className={td}>{row.value}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * The four player-insight mini tables on the Signal Scout overview: hardest
 * and easiest targets (win rate, minimum 5 completed rounds), most skipped
 * targets, and most guessed players. All four are pre-aggregated by
 * page.tsx from a single shared query window (see insights.ts).
 */
export function PlayerInsightTables({
  hardest,
  easiest,
  mostSkipped,
  mostGuessed,
  playerNames,
}: {
  hardest: HardestEasiestRow[];
  easiest: HardestEasiestRow[];
  mostSkipped: CountRow[];
  mostGuessed: CountRow[];
  playerNames: Map<string, PlayerLabel>;
}) {
  return (
    <section aria-labelledby="signal-scout-insight-heading">
      <h2
        id="signal-scout-insight-heading"
        className="text-xl font-semibold tracking-tight text-ink"
      >
        Player insights
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-ink-muted">
        Computed from the same completed-rounds window as the averages above. Hardest and
        easiest require at least 5 completed rounds as a target so a single round cannot
        dominate the rate.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <MiniTable
          id="signal-scout-hardest-heading"
          title="Hardest targets"
          caption="Ten players with the lowest win rate as a Signal Scout target, minimum 5 completed rounds."
          emptyText="No players have 5 completed rounds yet."
          columnLabel="Win rate"
          rows={winRateRows(hardest)}
          playerNames={playerNames}
        />
        <MiniTable
          id="signal-scout-easiest-heading"
          title="Easiest targets"
          caption="Ten players with the highest win rate as a Signal Scout target, minimum 5 completed rounds."
          emptyText="No players have 5 completed rounds yet."
          columnLabel="Win rate"
          rows={winRateRows(easiest)}
          playerNames={playerNames}
        />
        <MiniTable
          id="signal-scout-skipped-heading"
          title="Most skipped targets"
          caption="Ten players skipped most often as a Signal Scout target."
          emptyText="No skipped rounds yet."
          columnLabel="Skips"
          rows={countRows(mostSkipped)}
          playerNames={playerNames}
        />
        <MiniTable
          id="signal-scout-guessed-heading"
          title="Most guessed players"
          caption="Ten players guessed most often across the most recent guesses."
          emptyText="No guesses recorded yet."
          columnLabel="Guesses"
          rows={countRows(mostGuessed)}
          playerNames={playerNames}
        />
      </div>
    </section>
  );
}
