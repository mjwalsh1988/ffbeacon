/**
 * Section 6.4: who they like.
 *
 * Two lists (favourites, avoids) plus the repeat-drafts line. Each list
 * carries its own sample size in its `SectionFrame`'s `sampleNote`, since a
 * list of three and a list of three hundred are not the same claim.
 *
 * MOBILE: every player row renders TWICE, once as a table row (sm and up)
 * and once as a stacked card (below sm), from the same data. Nothing is
 * dropped at any breakpoint; the two renderings just lay the same four values
 * out differently for a narrow screen.
 */

import { SectionFrame } from "./section-frame";
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
    <SectionFrame id="affinity" title="Who they like" eyebrow="Section 4" accent="cyan" isSample={isSample}>
      <PlayerList
        heading="Favourites"
        explainer="Players they roster far more than how commonly that player is rostered everywhere else."
        players={affinity.favourites}
        sampleSize={affinity.favouritesSampleSize}
        sampleNoun="league-season"
        emptyReason="Not enough exposure yet to name a favourite."
        isSample={isSample}
      />

      <PlayerList
        heading="Avoids"
        explainer="An avoid is a player widely rostered elsewhere that this manager had the chance to add and never has."
        players={affinity.avoids}
        sampleSize={affinity.avoidsSampleSize}
        sampleNoun="league-season"
        emptyReason="No avoid pattern in this window."
        isSample={isSample}
      />

      <RepeatDrafts entries={affinity.repeatDrafts} sampleSize={affinity.repeatDraftsSampleSize} />
    </SectionFrame>
  );
}

/* ------------------------------------------------------------------ list */

function PlayerList({
  heading,
  explainer,
  players,
  sampleSize,
  sampleNoun,
  emptyReason,
  isSample,
}: {
  heading: string;
  explainer: string;
  players: PlayerExposure[];
  sampleSize: number;
  sampleNoun: string;
  emptyReason: string;
  isSample?: boolean;
}) {
  const sampleNote = formatSample(sampleSize, sampleNoun);
  return (
    <div>
      <h3 className="text-sm font-semibold text-ink">{heading}</h3>
      <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{explainer}</p>
      {sampleNote && <p className="mt-0.5 text-[11px] text-ink-subtle">{sampleNote}</p>}

      {players.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">{emptyReason}</p>
      ) : (
        <>
          {/* Desktop and up: a real table. */}
          <div className="mt-2 hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[26rem] border-collapse text-left text-xs">
              <caption className="sr-only">
                {isSample && "Sample data, not a real manager. "}
                {heading}: player, position, league-seasons rostered, and how commonly that
                player is rostered across every league in our database
              </caption>
              <thead>
                <tr className="border-b border-line text-[10px] uppercase tracking-wide text-ink-subtle">
                  <th scope="col" className="py-1.5 pr-3 font-semibold">
                    Player
                  </th>
                  <th scope="col" className="py-1.5 pr-3 font-semibold">
                    Position
                  </th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-semibold">
                    League-seasons rostered
                  </th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-semibold">
                    League-wide roster rate
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {players.map((player) => (
                  <tr key={player.playerId}>
                    <td className="py-1.5 pr-3 font-medium text-ink">{player.name}</td>
                    <td className="py-1.5 pr-3 text-ink-muted">
                      {player.position ?? (
                        <span>
                          {"--"}
                          <span className="sr-only"> Position not known</span>
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-ink-muted">
                      {player.leagueSeasonsRostered}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-ink-muted">
                      {formatPercent(player.leagueWideRosterRate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Below sm: the same four values, stacked per player. */}
          <ul className="mt-2 space-y-2 sm:hidden">
            {players.map((player) => (
              <li
                key={player.playerId}
                className="rounded-card border border-line bg-base/40 px-3 py-2"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-ink">{player.name}</span>
                  <span className="text-xs text-ink-muted">
                    {player.position ?? (
                      <span>
                        {"--"}
                        <span className="sr-only"> Position not known</span>
                      </span>
                    )}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink-muted">
                  Rostered in {player.leagueSeasonsRostered} league-season
                  {player.leagueSeasonsRostered === 1 ? "" : "s"}, versus{" "}
                  {formatPercent(player.leagueWideRosterRate)} league-wide.
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- repeats */

function RepeatDrafts({
  entries,
  sampleSize,
}: {
  entries: RepeatDraftEntry[];
  sampleSize: number;
}) {
  const sampleNote = formatSample(sampleSize, "draft");
  return (
    <div>
      <h3 className="text-sm font-semibold text-ink">Drafted more than once</h3>
      <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
        The same player taken in separate drafts, the loudest affinity signal there is.
      </p>
      {sampleNote && <p className="mt-0.5 text-[11px] text-ink-subtle">{sampleNote}</p>}

      {entries.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">No player drafted more than once yet.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {entries.map((entry) => (
            <li
              key={entry.playerId}
              className="flex items-center justify-between gap-3 rounded-card border border-line bg-base/40 px-3 py-2 text-sm"
            >
              <span className="text-ink">{entry.name}</span>
              <span className="tabular-nums text-ink-muted">
                {entry.timesDrafted} draft{entry.timesDrafted === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
