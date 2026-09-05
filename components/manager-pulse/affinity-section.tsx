/**
 * Section 6.4: who they like.
 *
 * Three findings that used to be three stacked tables, one under another, each
 * with its own heading and its own column rules, so the section read as a
 * filing cabinet rather than as an answer. They are three views of one
 * question, so they share one visual system:
 *
 *   Favourites  player tiles, led by how many league-seasons they rostered him
 *   Avoids      the same tile, led by how widely rostered he is everywhere else
 *   Repeats     a ranked bar chart, because it is one name and one count
 *
 * WHY A TILE AND NOT A TABLE. The old build rendered every player twice, a
 * table row from `sm` and a stacked card below it, from the same data. One
 * tile that works at every width replaces both, and the tile can carry the
 * thing a table row could not: the manager's own exposure drawn against how
 * commonly that player is rostered everywhere else, which is the entire point
 * of the finding and was previously two numbers a reader had to divide in
 * their head.
 *
 * The numbers are still available as a table. `ChartFigure` puts one behind a
 * disclosure under every chart on this site, and the same contract applies
 * here: a sighted keyboard reader and a screen reader both get the figures,
 * not just the picture.
 */

import { ChartFigure, DataTable, Th, Td } from "@/components/chart-kit";
import {
  POSITION_BADGE,
  POSITION_BADGE_FALLBACK,
  normalizePositionColor,
} from "@/lib/on-the-clock/position-colors";
import { SectionFrame } from "./section-frame";
import { RankedBars } from "./charts";
import type { RankedBarRow } from "./charts";
import { formatPercent, formatSample } from "./format";
import type { ManagerAffinity, PlayerExposure, RepeatDraftEntry } from "@/lib/manager-pulse/types";

export function AffinitySection({
  affinity,
  isSample,
}: {
  affinity: ManagerAffinity;
  /** True on the guest sample report. Prefixes each table's caption with a
   *  disclaimer, since a `<caption>` is the first thing announced on
   *  entering table navigation, the strongest fence a table can carry. */
  isSample?: boolean;
}) {
  return (
    <SectionFrame id="affinity" title="Who they like" accent="cyan" isSample={isSample}>
      {/* THE SAMPLE NOUN IS "PLAYER", NOT "LEAGUE-SEASON".
          `favouritesSampleSize` is `totals.size`: the count of distinct
          players this manager has any exposure to at all. Labelled
          league-seasons it read as "over 391 league-seasons" on a manager the
          same page says has 60. `avoidsSampleSize` below is the same shape:
          candidate players considered. */}
      <PlayerFigure
        title="Favourites"
        description="Players they roster far more often than that player is rostered anywhere else."
        players={affinity.favourites}
        sampleSize={affinity.favouritesSampleSize}
        sampleNoun="player"
        emptyReason="Not enough exposure yet to name a favourite."
        variant="favourite"
        isSample={isSample}
      />

      <PlayerFigure
        title="Avoids"
        description="Widely rostered players this manager had the chance to add and never has."
        players={affinity.avoids}
        sampleSize={affinity.avoidsSampleSize}
        sampleNoun="candidate player"
        emptyReason="No avoid pattern in this window."
        variant="avoid"
        isSample={isSample}
      />

      <RepeatDrafts entries={affinity.repeatDrafts} sampleSize={affinity.repeatDraftsSampleSize} />
    </SectionFrame>
  );
}

/* ------------------------------------------------------------------ tiles */

/**
 * One player, as a tile.
 *
 * The lead figure differs by variant, because the two findings lead with
 * different evidence. A favourite leads with how many league-seasons THIS
 * manager rostered him, which is the unusual thing about it. An avoid leads
 * with the league-wide rate, because the manager's own count is zero by
 * definition and printing a zero as the headline of a card says nothing.
 *
 * The bar underneath is the comparison, and it is `aria-hidden`: both numbers
 * it draws are stated in the sentence below it.
 */
function PlayerTile({
  player,
  variant,
  maxSeasons,
}: {
  player: PlayerExposure;
  variant: "favourite" | "avoid";
  /** The largest league-season count in this list, so the bars are comparable. */
  maxSeasons: number;
}) {
  const colorKey = normalizePositionColor(player.position);
  const badgeClass = colorKey ? POSITION_BADGE[colorKey] : POSITION_BADGE_FALLBACK;

  const leadValue =
    variant === "favourite"
      ? String(player.leagueSeasonsRostered)
      : formatPercent(player.leagueWideRosterRate);
  const leadLabel = variant === "favourite" ? "league-seasons" : "rostered elsewhere";

  const theirShare = maxSeasons > 0 ? player.leagueSeasonsRostered / maxSeasons : 0;

  return (
    <li className="rounded-card border border-line bg-base/40 px-3 py-2.5 transition-colors hover:border-brand-cyan/40">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {/* WRAPPED, NEVER TRUNCATED. "TreVeyon Hen..." is not a player a
              reader can identify, and the name is the whole row. */}
          <p className="line-clamp-2 break-words text-sm font-semibold leading-tight text-ink">
            {player.name}
          </p>
          <p className="mt-1">
            <span
              className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${badgeClass}`}
            >
              {player.position ?? (
                <>
                  {"--"}
                  <span className="sr-only"> Position not known</span>
                </>
              )}
            </span>
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p
            className={`font-mono text-3xl font-extrabold leading-none tabular-nums ${
              variant === "favourite" ? "text-brand-cyan" : "text-ink"
            }`}
          >
            {leadValue}
          </p>
          <p className="mt-0.5 text-[10px] uppercase tracking-wide text-ink-subtle">{leadLabel}</p>
        </div>
      </div>

      {variant === "favourite" && (
        <span
          aria-hidden="true"
          className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-line/50"
        >
          <span
            className="block h-full rounded-full bg-beacon"
            style={{ width: `${Math.max(4, Math.round(theirShare * 100))}%` }}
          />
        </span>
      )}

      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-muted">
        {variant === "favourite"
          ? `Rostered in ${player.leagueSeasonsRostered} league-season${player.leagueSeasonsRostered === 1 ? "" : "s"}, against ${formatPercent(player.leagueWideRosterRate)} of leagues everywhere.`
          : `Rostered in ${formatPercent(player.leagueWideRosterRate)} of leagues everywhere, and never once by them.`}
      </p>
    </li>
  );
}

function PlayerFigure({
  title,
  description,
  players,
  sampleSize,
  sampleNoun,
  emptyReason,
  variant,
  isSample,
}: {
  title: string;
  description: string;
  players: PlayerExposure[];
  sampleSize: number;
  sampleNoun: string;
  emptyReason: string;
  variant: "favourite" | "avoid";
  isSample?: boolean;
}) {
  const sampleNote = formatSample(sampleSize, sampleNoun);

  if (players.length === 0) {
    return (
      <div className="rounded-card border border-line bg-base/40 p-4">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{description}</p>
        <p className="mt-2 text-sm text-ink-muted">{emptyReason}</p>
      </div>
    );
  }

  const maxSeasons = Math.max(...players.map((p) => p.leagueSeasonsRostered), 0);
  const lead = players[0];

  const summary =
    variant === "favourite"
      ? `${title}: ${lead.name} leads, rostered in ${lead.leagueSeasonsRostered} of this manager's league-seasons against ${formatPercent(lead.leagueWideRosterRate)} of leagues everywhere. ${players.length} players listed.`
      : `${title}: ${lead.name} leads, rostered in ${formatPercent(lead.leagueWideRosterRate)} of leagues everywhere and never by this manager. ${players.length} players listed.`;

  return (
    <ChartFigure
      title={title}
      description={sampleNote ? `${description} Measured ${sampleNote}.` : description}
      summary={summary}
      titleLevel={3}
      tableLabel="View these as a table"
      table={
        <DataTable
          caption={`${isSample ? "Sample data, not a real manager. " : ""}${title}: player, position, league-seasons rostered, and how commonly that player is rostered across every league in our database`}
          head={
            <>
              <Th>Player</Th>
              <Th>Position</Th>
              <Th numeric>League-seasons rostered</Th>
              <Th numeric>League-wide roster rate</Th>
            </>
          }
        >
          {players.map((player) => (
            <tr key={player.playerId}>
              <Td>{player.name}</Td>
              <Td>
                {player.position ?? (
                  <>
                    {"--"}
                    <span className="sr-only"> Position not known</span>
                  </>
                )}
              </Td>
              <Td numeric>{player.leagueSeasonsRostered}</Td>
              <Td numeric>{formatPercent(player.leagueWideRosterRate)}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      {/* Two across from sm, three from xl. The main column is already narrowed
          by the report rail, so three only fits at the widest layout. */}
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {players.map((player) => (
          <PlayerTile
            key={player.playerId}
            player={player}
            variant={variant}
            maxSeasons={maxSeasons}
          />
        ))}
      </ul>
    </ChartFigure>
  );
}

/* --------------------------------------------------------------- repeats */

/**
 * The same player taken in separate drafts, as a ranked bar chart.
 *
 * One name and one count per row is exactly what a bar chart is for, and the
 * ranking is the finding: the top of this list is the loudest affinity signal
 * in the report. The list is capped on screen with the rest behind a
 * disclosure, because a manager in thirty leagues fills it.
 */
const REPEATS_SHOWN = 8;

function RepeatDrafts({
  entries,
  sampleSize,
}: {
  entries: RepeatDraftEntry[];
  sampleSize: number;
}) {
  const sampleNote = formatSample(sampleSize, "draft");

  if (entries.length === 0) {
    return (
      <div className="rounded-card border border-line bg-base/40 p-4">
        <h3 className="text-sm font-semibold text-ink">Drafted more than once</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
          The same player taken in separate drafts, the loudest affinity signal there is.
        </p>
        <p className="mt-2 text-sm text-ink-muted">No player drafted more than once yet.</p>
      </div>
    );
  }

  const toRow = (entry: RepeatDraftEntry, index: number): RankedBarRow => ({
    key: entry.playerId,
    label: entry.name,
    value: entry.timesDrafted,
    display: `${entry.timesDrafted}`,
    lead: index === 0,
    barClass: index === 0 ? "bg-beacon" : "bg-brand-purple/60",
  });

  const shown = entries.slice(0, REPEATS_SHOWN).map(toRow);
  const rest = entries.slice(REPEATS_SHOWN).map(toRow);
  const lead = entries[0];

  return (
    <ChartFigure
      title="Drafted more than once"
      description={
        sampleNote
          ? `The same player taken in separate drafts, the loudest affinity signal there is. Measured ${sampleNote}.`
          : "The same player taken in separate drafts, the loudest affinity signal there is."
      }
      summary={`${lead.name} has been drafted ${lead.timesDrafted} separate times, more than any other player. ${entries.length} players have been drafted more than once.`}
      titleLevel={3}
      tableLabel="View these as a table"
      table={
        <DataTable
          caption="Players this manager has taken in more than one draft, and how many drafts each"
          head={
            <>
              <Th>Player</Th>
              <Th numeric>Drafts</Th>
            </>
          }
        >
          {entries.map((entry) => (
            <tr key={entry.playerId}>
              <Td>{entry.name}</Td>
              <Td numeric>{entry.timesDrafted}</Td>
            </tr>
          ))}
        </DataTable>
      }
    >
      <RankedBars rows={shown} labelWidthClass="sm:w-44" />
      {rest.length > 0 && (
        <details className="group mt-2">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-xs font-semibold text-brand-cyan transition-colors hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan">
            <span className="group-open:hidden">Show the other {rest.length}</span>
            <span className="hidden group-open:inline">Show fewer</span>
          </summary>
          <div className="mt-2">
            <RankedBars rows={rest} labelWidthClass="sm:w-44" />
          </div>
        </details>
      )}
    </ChartFigure>
  );
}
