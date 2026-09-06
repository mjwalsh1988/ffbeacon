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
import { LayoutBuilder } from "../layout-builder";
import { saveLayout } from "../actions";
import {
  type SignalBlock,
  parseLayoutConfig,
  hasStoredBlocks,
  resolveLayout,
  seedBlocksFromProfile,
} from "@/lib/signal/blocks";

export const metadata: Metadata = { title: "Layout | My Signal" };

/** True when the link list contains at least one https web link, mirroring the
 * public resolver (which drops non-https rows). Drives the layout seed. */
function hasHttpsLink(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.some(
    (item) =>
      item &&
      typeof item === "object" &&
      typeof (item as { url?: unknown }).url === "string" &&
      (item as { url: string }).url.startsWith("https://"),
  );
}

export default async function SignalLayoutPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const signal = await loadOwnerSignal(supabase, user!.id);
  if (!signal) redirect("/my-beacon/signal");

  // Profile-visible boards, in profile order, for the board-block picker.
  const { data: boardRows } = await supabase
    .from("user_ranking_boards")
    .select("id, name, profile_is_primary, profile_sort")
    .eq("user_id", user!.id)
    .eq("profile_visible", true)
    .order("profile_is_primary", { ascending: false })
    .order("profile_sort", { ascending: true });
  const profileBoardOptions = (boardRows ?? []).map((b) => ({
    id: b.id,
    name: b.name,
  }));

  // Featured-league options for the league blocks. Resolved through the owner's
  // current Sleeper memberships (matching the original single-page behavior, so
  // a league the owner has left drops out of the picker), then narrowed to the
  // featured ids in the owner's saved order.
  //
  // The saved identity already carries the Sleeper user id (D3), so this page
  // now usually reaches Sleeper zero times. `ensureSleeperUserId` is the one
  // call a row saved before migration 0268 still costs, and it writes the id
  // back so the next visit costs none.
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

  type FeaturedLeague = { sleeperLeagueId: string; name: string; season: number };
  let leagueOptions: FeaturedLeague[] = [];
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
        .select("id, sleeper_league_id, name, season")
        .in("id", leagueIds)
        .order("season", { ascending: false });
      leagueOptions = (leagueRows ?? []).map((l) => ({
        sleeperLeagueId: l.sleeper_league_id,
        name: l.name,
        season: l.season,
      }));
    }
  }
  const leagueBySleeperId = new Map(
    leagueOptions.map((l) => [l.sleeperLeagueId, l]),
  );
  const featuredLeagueOptions: FeaturedLeague[] = (
    settings.signal_league_ids ?? []
  )
    .map((id) => leagueBySleeperId.get(id))
    .filter((l): l is FeaturedLeague => !!l);

  // The builder's initial state mirrors what the public resolver renders: parse
  // the stored layout_config, or seed from current data when none exists yet, so
  // "what you arrange" equals "what is live".
  const initialLayout = resolveLayout(signal.layout);
  let initialBlocks: SignalBlock[] = parseLayoutConfig(signal.layout_config);
  if (!hasStoredBlocks(signal.layout_config)) {
    initialBlocks = seedBlocksFromProfile({
      hasBio: !!(signal.bio && signal.bio.trim()),
      hasFavorites: !!(signal.favorite_team || signal.favorite_player_id),
      hasLinks: hasHttpsLink(signal.links),
      boardIds: profileBoardOptions.map((b) => b.id),
      sleeperLeagueIds: featuredLeagueOptions.map((l) => l.sleeperLeagueId),
    });
  }

  return (
    <SignalEditorShell
      title="Layout"
      description="Choose a layout and arrange the blocks visitors see. Removing a block here only takes it off your layout; it never deletes your boards, leagues, links, or favorites. The Wall always stays below."
    >
      <div className="max-w-2xl">
        <LayoutBuilder
          initialLayout={initialLayout}
          initialBlocks={initialBlocks}
          boardOptions={profileBoardOptions}
          leagueOptions={featuredLeagueOptions}
          onSave={saveLayout}
        />
      </div>
    </SignalEditorShell>
  );
}
