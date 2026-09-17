/**
 * Beacon Brief tab: the newest Relays that mention this player, each linking
 * to its permalink and, once one exists, to the Brief that covered it. Async
 * server component; reads through the anon server client, whose RLS already
 * limits relays to status = 'published'.
 */

import { Newspaper } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageBody } from "@/components/app-shell/page-body";
import { Panel } from "@/components/dashboard-panel";
import { RelayCard } from "@/components/relays/relay-card";
import { loadRelaysForPlayer } from "@/lib/relays/load";
import type { PlayerRow } from "@/lib/player-profile";

const PROFILE_RELAY_LIMIT = 5;

export async function BeaconBriefTab({
  player,
  playerName,
}: {
  player: PlayerRow;
  playerName: string;
}) {
  const supabase = await createClient();
  const relays = await loadRelaysForPlayer(supabase, player.id, PROFILE_RELAY_LIMIT);

  return (
    <PageBody>
      <Panel
        eyebrow="News"
        title="The Beacon Brief"
        helper={`The newest reports that mention ${playerName}`}
      >
        {relays.length > 0 ? (
          <ul role="list" className="space-y-4">
            {relays.map((relay) => (
              <li key={relay.id}>
                <RelayCard relay={relay} headingLevel={3} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex items-start gap-3 rounded-card border border-dashed border-line bg-base/40 p-6">
            <span
              aria-hidden="true"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line bg-surface text-brand-cyan"
            >
              <Newspaper className="h-5 w-5" />
            </span>
            <div>
              <p className="text-base font-semibold text-ink">No reports yet</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                No Beacon Brief report mentions {playerName} yet. Player news will appear here as
                the desk accepts it.
              </p>
            </div>
          </div>
        )}
      </Panel>
    </PageBody>
  );
}
