"use client";

import { SidePanel } from "@/components/side-panel";
import { TradeFinder } from "@/components/trade-finder";

/**
 * Trade Finder across every league, as a panel on My Sleeper Leagues.
 *
 * Same component, same engine, same one-at-a-time answer as the league tab. The
 * only difference is where a suggestion is allowed to come from, and the card
 * carrying a league name because the page is no longer about one room.
 *
 * IT WALKS RATHER THAN SWEEPING. Each press opens a few leagues, returns the
 * best deal it found in them, and remembers where it stopped, so a manager with
 * fourteen rooms gets through all of them one deal at a time without any single
 * press costing fourteen leagues of work. The panel says how many are still to
 * come rather than leaving that to be guessed at.
 *
 * SYNCS NOTHING. It reads leagues that are already stored. One that has never
 * been opened cannot be searched and is counted as unread rather than silently
 * skipped, which is the same contract Free Agent Finder holds.
 */
export function TradeFinderPanel({
  open,
  onClose,
  sleeperLeagueIds,
  sleeperUserId,
  sleeperUsername,
  syncedLeagueCount,
  sourceSlug,
}: {
  open: boolean;
  onClose: () => void;
  /** Every league Sleeper reports for this reader, synced or not. */
  sleeperLeagueIds: string[];
  /** The reader's Sleeper id, which is how their roster is found in each room. */
  sleeperUserId: string | null;
  sleeperUsername: string | null;
  /** Of those leagues, how many we hold rosters for. */
  syncedLeagueCount: number;
  sourceSlug: string | null;
}) {
  const unsynced = Math.max(0, sleeperLeagueIds.length - syncedLeagueCount);

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title="Trade Finder"
      subtitle={`One trade at a time, across ${syncedLeagueCount} synced ${syncedLeagueCount === 1 ? "league" : "leagues"}`}
      size="lg"
    >
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-ink-muted">
          Every league you are in, searched a few at a time. Step through what it
          finds, save the ones worth coming back to, and search again for the
          leagues it has not opened yet.
        </p>

        {unsynced > 0 && (
          <p className="rounded-card border border-line bg-base/40 p-3 text-sm text-ink-muted">
            {unsynced} of your {sleeperLeagueIds.length} leagues{" "}
            {unsynced === 1 ? "is" : "are"} not synced, so{" "}
            {unsynced === 1 ? "it is" : "they are"} not searched. Open one once
            to bring it in.
          </p>
        )}

        {!sleeperUserId ? (
          <p className="rounded-card border border-dashed border-line bg-base/40 p-4 text-sm text-ink-muted">
            Save your Sleeper username above to use this.
          </p>
        ) : (
          <TradeFinder
            mode="portfolio"
            isSignedIn
            sleeperLeagueIds={sleeperLeagueIds}
            sleeperUserId={sleeperUserId}
            searchedUsername={sleeperUsername}
            source={sourceSlug}
          />
        )}
      </div>
    </SidePanel>
  );
}
