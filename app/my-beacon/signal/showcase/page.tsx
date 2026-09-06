import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseSleeperLeagueSettings } from "@/lib/sleeper-league-settings";
import {
  ensureSleeperUserId,
  loadSavedSleeperHandle,
} from "@/lib/sleeper-handle/resolve";
import { loadOwnerSignal } from "@/lib/signal/editor-data";
import { SignalEditorShell } from "@/components/signal/signal-editor-shell";
import { LinksEditor } from "../links-editor";
import { FavoritesEditor } from "../favorites-editor";
import {
  SignalLeaguesManager,
  type SignalLeagueOption,
} from "../signal-leagues-manager";
import type { SignalLink, PlayerSearchResult } from "../customization";

export const metadata: Metadata = { title: "Showcase | My Signal" };

/** Coerce the signals.links jsonb into a typed, shape-safe list for the editor.
 * The DB shape guard (migration 0069) already enforces this, but we parse
 * defensively so a malformed row never crashes the page. */
function parseLinks(value: unknown): SignalLink[] {
  if (!Array.isArray(value)) return [];
  const out: SignalLink[] = [];
  for (const item of value) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as { label?: unknown }).label === "string" &&
      typeof (item as { url?: unknown }).url === "string"
    ) {
      out.push({
        label: (item as { label: string }).label,
        url: (item as { url: string }).url,
      });
    }
  }
  return out;
}

export default async function SignalShowcasePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const signal = await loadOwnerSignal(supabase, user!.id);
  if (!signal) redirect("/my-beacon/signal");

  const initialLinks = parseLinks(signal.links);

  // Resolve the saved favorite player (if any) into the shape the typeahead
  // renders for its initial selected state.
  let favoritePlayer: PlayerSearchResult | null = null;
  if (signal.favorite_player_id) {
    const { data: p } = await supabase
      .from("players")
      .select("id, slug, full_name, first_name, last_name, position, team")
      .eq("id", signal.favorite_player_id)
      .maybeSingle();
    if (p) {
      favoritePlayer = {
        id: p.id,
        slug: p.slug,
        name: p.full_name || `${p.first_name} ${p.last_name}`.trim(),
        position: p.position,
        team: p.team,
      };
    }
  }

  // Featured-league picker data: the owner's already-synced leagues, matched
  // against synced league_users rows by the reader's Sleeper user id.
  //
  // That id is stored with the handle (D3), so this page usually reaches
  // Sleeper zero times. `ensureSleeperUserId` is the one call a row saved
  // before migration 0268 still costs, and it writes the id back.
  const { data: prefs } = await supabase
    .from("user_preferences")
    .select("sleeper_league_settings")
    .eq("user_id", user!.id)
    .maybeSingle();
  // The LEAGUE keys only: signal_league_ids. The identity is resolved below.
  const settings = parseSleeperLeagueSettings(prefs?.sleeper_league_settings);

  const savedHandle = await loadSavedSleeperHandle(supabase);
  const handle =
    savedHandle && !savedHandle.sleeperUserId
      ? await ensureSleeperUserId(supabase, savedHandle)
      : savedHandle;

  let leagueOptions: SignalLeagueOption[] = [];
  if (handle?.sleeperUserId) {
    const { data: memberships } = await supabase
      .from("league_users")
      .select("league_id")
      .eq("sleeper_user_id", handle.sleeperUserId);
    const leagueIds = Array.from(
      new Set((memberships ?? []).map((m) => m.league_id)),
    );
    if (leagueIds.length > 0) {
      const { data: leagueRows } = await supabase
        .from("leagues")
        .select("id, sleeper_league_id, name, season, total_rosters")
        .in("id", leagueIds)
        .order("season", { ascending: false });
      leagueOptions = (leagueRows ?? []).map((l) => ({
        sleeperLeagueId: l.sleeper_league_id,
        name: l.name,
        season: l.season,
        totalRosters: l.total_rosters,
      }));
    }
  }

  return (
    <SignalEditorShell
      title="Showcase"
      description="Point visitors to your other channels, call out your favorite team and player, and feature the Sleeper leagues you play in. Everything here is optional."
    >
      <div className="space-y-6">
        <section aria-labelledby="signal-links-heading">
          <h3
            id="signal-links-heading"
            className="text-lg font-semibold tracking-tight text-ink"
          >
            Links
          </h3>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
            Add links to your podcast, channel, newsletter, or socials. Only
            secure https web addresses are accepted.
          </p>
          <div className="mt-4 max-w-2xl">
            <LinksEditor initialLinks={initialLinks} />
          </div>
        </section>

        <section aria-labelledby="signal-favorites-heading">
          <h3
            id="signal-favorites-heading"
            className="text-lg font-semibold tracking-tight text-ink"
          >
            Favorites
          </h3>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
            Pick your favorite NFL team and a favorite player to show a bit of
            personality on your profile.
          </p>
          <div className="mt-4 max-w-2xl">
            <FavoritesEditor
              initialTeam={signal.favorite_team}
              initialPlayer={favoritePlayer}
            />
          </div>
        </section>

        <section aria-labelledby="signal-leagues-heading">
          <h3
            id="signal-leagues-heading"
            className="text-lg font-semibold tracking-tight text-ink"
          >
            Featured leagues
          </h3>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
            Show off your Sleeper leagues on your profile. Only leagues you have
            already opened in League Pulse appear here, and visitors see clean
            summary cards, never your private data.
          </p>
          <div className="mt-4 max-w-2xl">
            <SignalLeaguesManager
              leagues={leagueOptions}
              initialFeaturedIds={settings.signal_league_ids ?? []}
            />
          </div>
        </section>
      </div>
    </SignalEditorShell>
  );
}
