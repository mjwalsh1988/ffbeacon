import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { SITE } from "@/lib/site";
import { getSleeperUser } from "@/lib/sleeper";
import { parseSleeperLeagueSettings } from "@/lib/sleeper-league-settings";
import { isSignalAccent, DEFAULT_ACCENT } from "@/lib/signal/accents";
import { HandleManager } from "./handle-manager";
import { IdentityForm } from "./identity-form";
import { AccentPicker } from "./accent-picker";
import { LinksEditor } from "./links-editor";
import { FavoritesEditor } from "./favorites-editor";
import { MediaUploader } from "./media-uploader";
import { PublishControls } from "./publish-controls";
import { WallComposer } from "./wall-composer";
import { WallManager } from "./wall-manager";
import type { WallPost, WallImage } from "@/lib/signal-wall";
import type { SignalLink, PlayerSearchResult } from "./customization";
import {
  SignalLeaguesManager,
  type SignalLeagueOption,
} from "./signal-leagues-manager";

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

export const metadata: Metadata = {
  title: "My Signal",
  description:
    "Build your public FF Beacon creator profile: handle, identity, avatar, banner, and visibility.",
};

const BUCKET = "signal-media";

export default async function MySignalPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: signal } = await supabase
    .from("signals")
    .select(
      "id, handle, display_name, headline, bio, avatar_path, banner_path, status, visibility, accent, links, favorite_team, favorite_player_id",
    )
    .eq("user_id", user!.id)
    .maybeSingle();

  const publicUrlFor = (path: string | null) =>
    path ? supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : null;

  // Resolve the saved favorite player (if any) into the shape the typeahead
  // renders for its initial selected state.
  let favoritePlayer: PlayerSearchResult | null = null;
  if (signal?.favorite_player_id) {
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

  const initialAccent = isSignalAccent(signal?.accent)
    ? signal.accent
    : DEFAULT_ACCENT;
  const initialLinks = parseLinks(signal?.links);

  // Owner's own Wall posts, in any state. RLS signal_posts_select_own returns
  // the owner's posts including hidden ones, so the manager can flag takedowns.
  let wallPosts: WallPost[] = [];
  if (signal) {
    const { data: postRows } = await supabase
      .from("signal_posts")
      .select("id, body, pinned, hidden, hidden_reason, created_at, edited_at")
      .eq("signal_id", signal.id)
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100);
    const rows = postRows ?? [];

    // Images for these posts (owner RLS returns the owner's own), grouped by post.
    const imagesByPost = new Map<string, WallImage[]>();
    if (rows.length > 0) {
      const { data: imageRows } = await supabase
        .from("signal_post_images")
        .select("post_id, storage_path, alt_text, width, height, ordinal")
        .in(
          "post_id",
          rows.map((r) => r.id),
        )
        .order("ordinal", { ascending: true });
      for (const img of imageRows ?? []) {
        const url = publicUrlFor(img.storage_path);
        if (!url) continue;
        const list = imagesByPost.get(img.post_id) ?? [];
        list.push({
          url,
          alt: img.alt_text,
          width: img.width,
          height: img.height,
        });
        imagesByPost.set(img.post_id, list);
      }
    }

    wallPosts = rows.map((row) => ({
      id: row.id,
      body: row.body,
      pinned: row.pinned,
      hidden: row.hidden,
      hiddenReason: row.hidden_reason,
      createdAt: row.created_at,
      editedAt: row.edited_at,
      images: imagesByPost.get(row.id) ?? [],
    }));
  }

  // Featured-league picker data: the owner's already-synced leagues. We resolve
  // their Sleeper user id from the saved username and match synced league_users
  // rows. (This editor page MAY call Sleeper; the public profile never does.)
  const { data: prefs } = await supabase
    .from("user_preferences")
    .select("sleeper_league_settings")
    .eq("user_id", user!.id)
    .maybeSingle();
  const settings = parseSleeperLeagueSettings(prefs?.sleeper_league_settings);

  let leagueOptions: SignalLeagueOption[] = [];
  if (signal && settings.username) {
    const sleeperUser = await getSleeperUser(settings.username);
    if (sleeperUser) {
      const { data: memberships } = await supabase
        .from("league_users")
        .select("league_id")
        .eq("sleeper_user_id", sleeperUser.user_id);
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
  }

  return (
    <div className="space-y-12">
      <section aria-labelledby="signal-intro-heading">
        <SectionEyebrow>Your Signal</SectionEyebrow>
        <h2
          id="signal-intro-heading"
          className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl"
        >
          Your public creator profile.
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
          Your Signal is a shareable landing page for your fantasy presence. Claim
          a handle, set up your identity, then publish when you are ready. It stays
          private until you publish it.
        </p>
      </section>

      {!signal ? (
        <section aria-labelledby="signal-claim-heading">
          <h2
            id="signal-claim-heading"
            className="text-lg font-semibold tracking-tight text-ink"
          >
            Claim your handle to get started.
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
            This is your public address and cannot be one of our reserved words.
            You can change it later (once every 30 days).
          </p>
          <div className="mt-4 max-w-2xl">
            <HandleManager currentHandle={null} />
          </div>
        </section>
      ) : (
        <>
          <section aria-labelledby="signal-handle-heading">
            <h2
              id="signal-handle-heading"
              className="text-lg font-semibold tracking-tight text-ink"
            >
              Handle
            </h2>
            <div className="mt-4 max-w-2xl">
              <HandleManager currentHandle={signal.handle} />
            </div>
          </section>

          <section aria-labelledby="signal-identity-heading">
            <h2
              id="signal-identity-heading"
              className="text-lg font-semibold tracking-tight text-ink"
            >
              Identity
            </h2>
            <div className="mt-4 max-w-2xl">
              <IdentityForm
                initialDisplayName={signal.display_name ?? ""}
                initialHeadline={signal.headline ?? ""}
                initialBio={signal.bio ?? ""}
              />
            </div>
          </section>

          <section aria-labelledby="signal-appearance-heading">
            <h2
              id="signal-appearance-heading"
              className="text-lg font-semibold tracking-tight text-ink"
            >
              Appearance
            </h2>
            <div className="mt-4 max-w-2xl">
              <AccentPicker initialAccent={initialAccent} />
            </div>
          </section>

          <section aria-labelledby="signal-images-heading">
            <h2
              id="signal-images-heading"
              className="text-lg font-semibold tracking-tight text-ink"
            >
              Images
            </h2>
            <div className="mt-4 grid max-w-2xl gap-4 sm:grid-cols-2">
              <MediaUploader kind="avatar" initialUrl={publicUrlFor(signal.avatar_path)} />
              <MediaUploader kind="banner" initialUrl={publicUrlFor(signal.banner_path)} />
            </div>
          </section>

          <section aria-labelledby="signal-links-heading">
            <h2
              id="signal-links-heading"
              className="text-lg font-semibold tracking-tight text-ink"
            >
              Links
            </h2>
            <div className="mt-4 max-w-2xl">
              <LinksEditor initialLinks={initialLinks} />
            </div>
          </section>

          <section aria-labelledby="signal-favorites-heading">
            <h2
              id="signal-favorites-heading"
              className="text-lg font-semibold tracking-tight text-ink"
            >
              Favorites
            </h2>
            <div className="mt-4 max-w-2xl">
              <FavoritesEditor
                initialTeam={signal.favorite_team}
                initialPlayer={favoritePlayer}
              />
            </div>
          </section>

          <section aria-labelledby="signal-leagues-heading">
            <h2
              id="signal-leagues-heading"
              className="text-lg font-semibold tracking-tight text-ink"
            >
              Featured leagues
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
              Show off your Sleeper leagues on your profile. Only leagues you
              have already opened in League Pulse appear here, and visitors see
              clean summary cards, never your private data.
            </p>
            <div className="mt-4 max-w-2xl">
              <SignalLeaguesManager
                leagues={leagueOptions}
                initialFeaturedIds={settings.signal_league_ids ?? []}
              />
            </div>
          </section>

          <section aria-labelledby="signal-wall-heading">
            <h2
              id="signal-wall-heading"
              className="text-lg font-semibold tracking-tight text-ink"
            >
              Wall
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
              Post short updates to your public profile. Visitors see your posts
              newest first, with any pinned post at the top. You can edit or
              delete your posts at any time.
            </p>
            <div className="mt-4 max-w-2xl space-y-6">
              <WallComposer />
              <WallManager posts={wallPosts} />
            </div>
          </section>

          <section aria-labelledby="signal-publish-heading">
            <h2
              id="signal-publish-heading"
              className="text-lg font-semibold tracking-tight text-ink"
            >
              Visibility
            </h2>
            <div className="mt-4 max-w-2xl">
              <PublishControls
                initialStatus={signal.status as "draft" | "published"}
                initialVisibility={signal.visibility as "public" | "private"}
                publicUrl={`${SITE.url}/u/${signal.handle}`}
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
      {children}
    </p>
  );
}
