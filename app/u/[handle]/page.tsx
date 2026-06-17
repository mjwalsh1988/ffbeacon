import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getIsAdmin } from "@/lib/admin-auth";
import { SITE } from "@/lib/site";
import { accentGradient } from "@/lib/signal";
import {
  loadProfileBundle,
  resolveHistoricalHandle,
  isProfileLive,
  signalMediaUrl,
  type ProfileBundle,
  type ResolvedBlock,
} from "@/lib/signal-profile";
import {
  loadWallPosts,
  loadReactionsForTargets,
  type WallPost,
  type WallReactions,
} from "@/lib/signal-wall";
import { blockColumn } from "@/lib/signal/blocks";
import { ImageWithFallback } from "@/components/image-with-fallback";
import {
  AboutBlock,
  TextBlock,
  FeaturedBoardBlock,
  FeaturedLeagueBlock,
  LinksBlock,
  FavoritesBlock,
} from "@/components/signal/signal-block";
import { WallBlock } from "@/components/signal/wall";
import { SidebarShell } from "@/components/signal/sidebar-shell";
import { BeaconCard } from "@/components/signal/beacon-card";
import { WallDisclosure } from "@/components/signal/wall-disclosure";

// The Wall is read live (not cached) so new posts and moderation take effect
// immediately, so this route renders dynamically. The heavy identity bundle is
// still served from its own unstable_cache data cache (tagged signal:{handle}),
// so a dynamic render only adds one indexed posts query per request.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const raw = (await params).handle.toLowerCase();
  const { signal } = await loadProfileBundle(raw);
  if (!signal) {
    return { title: "Profile not found", robots: { index: false, follow: false } };
  }

  const isLive = isProfileLive(signal);
  const title = `${signal.display_name} (@${signal.handle})`;
  const description =
    signal.headline ||
    (signal.bio ? signal.bio.slice(0, 160) : `${signal.display_name} on ${SITE.name}.`);
  const url = `${SITE.url}/u/${signal.handle}`;
  const ogImage = `${SITE.url}/api/og/signal/${signal.handle}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    // Drafts, private, and hidden profiles must never be indexed, even though
    // the owner can still load them for preview.
    robots: isLive ? undefined : { index: false, follow: false },
    openGraph: {
      type: "profile",
      title,
      description,
      url,
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

export default async function SignalProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const rawHandle = (await params).handle;
  const handle = rawHandle.toLowerCase();

  const bundle = await loadProfileBundle(handle);

  if (!bundle.signal) {
    const redirectTo = await resolveHistoricalHandle(handle);
    if (redirectTo) permanentRedirect(`/u/${redirectTo}`);
    notFound();
  }

  const signal = bundle.signal;

  // Canonicalize casing: /u/Michael -> /u/michael (the stored handle).
  if (rawHandle !== signal.handle) {
    permanentRedirect(`/u/${signal.handle}`);
  }

  // Live path: the identity bundle still comes from the data cache, but the Wall
  // is read live. We resolve the viewer here (the page is force-dynamic) so the
  // comment composer, author edit/delete, and owner/admin moderation controls can
  // render correctly. The viewer identity never enters the cached bundle.
  if (isProfileLive(signal)) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const isWallOwner = !!user && user.id === signal.user_id;
    const isAdmin = user ? await getIsAdmin(supabase) : false;
    const canModerate = isWallOwner || isAdmin;

    // Public posts (hidden excluded). Hidden comments are included only for a
    // viewer who can moderate this Wall (owner or admin), and are flagged in UI.
    const posts = await loadWallPosts(signal.id, {
      includeHiddenComments: canModerate,
    });
    const reactions = await loadReactionsForTargets(
      collectReactionTargets(posts),
      user?.id ?? null,
    );
    return (
      <ProfileBody
        bundle={bundle}
        ownerPreview={false}
        posts={posts}
        viewerUserId={user?.id ?? null}
        viewerIsAdmin={isAdmin}
        viewerIsWallOwner={isWallOwner}
        reactions={reactions}
      />
    );
  }

  // Not live: the only viewer allowed is the owner (preview). This path reads
  // cookies and shows the owner's hidden posts and hidden comments flagged.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== signal.user_id) {
    notFound();
  }

  const posts = await loadWallPosts(signal.id, {
    includeHidden: true,
    includeHiddenComments: true,
  });
  const reactions = await loadReactionsForTargets(
    collectReactionTargets(posts),
    user.id,
  );
  return (
    <ProfileBody
      bundle={bundle}
      ownerPreview
      posts={posts}
      viewerUserId={user.id}
      viewerIsAdmin={false}
      viewerIsWallOwner
      reactions={reactions}
    />
  );
}

/** Flatten loaded posts (and their comments) into the reaction target list. */
function collectReactionTargets(
  posts: WallPost[],
): { type: "post" | "comment"; id: string }[] {
  const targets: { type: "post" | "comment"; id: string }[] = [];
  for (const post of posts) {
    targets.push({ type: "post", id: post.id });
    for (const comment of post.comments) {
      targets.push({ type: "comment", id: comment.id });
    }
  }
  return targets;
}

function ProfileBody({
  bundle,
  ownerPreview,
  posts,
  viewerUserId,
  viewerIsAdmin,
  viewerIsWallOwner,
  reactions,
}: {
  bundle: ProfileBundle;
  ownerPreview: boolean;
  posts: WallPost[];
  viewerUserId: string | null;
  viewerIsAdmin: boolean;
  viewerIsWallOwner: boolean;
  reactions: WallReactions;
}) {
  const signal = bundle.signal!;
  const avatar = signalMediaUrl(signal.avatar_path);
  const banner = signalMediaUrl(signal.banner_path);
  const gradient = accentGradient(signal.accent);
  const isSidebar = bundle.layout === "sidebar";
  const isSpotlight = bundle.layout === "spotlight";
  const headerWidth = isSidebar ? "max-w-6xl" : "max-w-3xl";
  // Spotlight centers the hero (avatar, name, headline) like a landing page;
  // Layouts A and B keep the avatar-left, text-right header.
  const heroInner = isSpotlight
    ? "-mt-12 flex flex-col items-center gap-4 pb-8 text-center sm:-mt-14"
    : "-mt-12 flex flex-col gap-4 pb-8 sm:-mt-14 sm:flex-row sm:items-end";

  // The Wall is fixed below the blocks in the main column (Layout A and B alike):
  // it is not a builder block and is never reorderable.
  const wall = (
    <WallBlock
      posts={posts}
      ownerPreview={ownerPreview}
      viewerUserId={viewerUserId}
      viewerIsAdmin={viewerIsAdmin}
      viewerIsWallOwner={viewerIsWallOwner}
      reactions={reactions}
    />
  );

  return (
    <main id="main">
      {ownerPreview && (
        <div
          role="status"
          className="border-b border-line bg-surface px-4 py-2.5 text-center text-sm text-ink-muted"
        >
          {signal.hidden
            ? "This profile has been hidden by a moderator and is not visible to anyone. "
            : `Preview. Your profile is ${signal.status === "draft" ? "a draft" : "private"} and is not visible to anyone but you. `}
          <a
            href="/my-beacon/signal"
            className="font-medium text-brand-cyan underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Edit your Signal
          </a>
        </div>
      )}

      <header className="relative border-b border-line">
        {/* Banner: decorative, so the image carries empty alt. A gradient stands
            in when no banner is set. */}
        {banner ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={banner} alt="" className="h-40 w-full object-cover sm:h-56" />
        ) : (
          <div
            aria-hidden="true"
            className="h-40 w-full sm:h-56"
            style={{ backgroundImage: gradient }}
          />
        )}

        <div className={`mx-auto ${headerWidth} px-4 sm:px-6`}>
          <div className={heroInner}>
            <div className="rounded-full ring-4 ring-base">
              <ImageWithFallback
                src={avatar}
                alt={`${signal.display_name} avatar`}
                size={112}
              />
            </div>
            <div className={isSpotlight ? "min-w-0" : "min-w-0 flex-1"}>
              <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
                {signal.display_name}
              </h1>
              <p className="mt-0.5 font-mono text-sm text-ink-muted">
                @{signal.handle}
              </p>
              {signal.headline && (
                <p className="mt-2 text-base leading-relaxed text-ink-muted">
                  {signal.headline}
                </p>
              )}
            </div>
          </div>
        </div>
      </header>

      {isSpotlight ? (
        <SpotlightLayout
          handle={signal.handle}
          accent={signal.accent}
          blocks={bundle.blocks}
          wall={wall}
          stats={{
            boards: bundle.boards.length,
            leagues: bundle.leagues.length,
            favoriteTeam: bundle.favorites.team?.name ?? null,
            posts: posts.length,
          }}
        />
      ) : isSidebar ? (
        <SidebarLayout
          handle={signal.handle}
          accent={signal.accent}
          blocks={bundle.blocks}
          wall={wall}
        />
      ) : (
        <FeedLayout
          handle={signal.handle}
          accent={signal.accent}
          blocks={bundle.blocks}
          wall={wall}
        />
      )}
    </main>
  );
}

/** Render one resolved block. The block has already been gated by the resolver,
 * so every branch here is safe to render. */
function renderBlock(
  block: ResolvedBlock,
  handle: string,
  accent: string,
): React.ReactNode {
  switch (block.type) {
    case "about":
      return <AboutBlock key={block.id} bio={block.bio} />;
    case "text":
      return <TextBlock key={block.id} text={block.text} />;
    case "links":
      return <LinksBlock key={block.id} links={block.links} accent={accent} />;
    case "favorites":
      return (
        <FavoritesBlock key={block.id} favorites={block.favorites} accent={accent} />
      );
    case "board_top_n":
      return (
        <FeaturedBoardBlock key={block.id} handle={handle} board={block.board} />
      );
    case "league_card":
      return <FeaturedLeagueBlock key={block.id} league={block.league} />;
  }
}

/** Layout A: a single column. Every block renders in list order, then the Wall. */
function FeedLayout({
  handle,
  accent,
  blocks,
  wall,
}: {
  handle: string;
  accent: string;
  blocks: ResolvedBlock[];
  wall: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6">
      {blocks.map((block) => renderBlock(block, handle, accent))}
      {wall}
    </div>
  );
}

/**
 * Layout B: a full-width header (rendered above) over two columns. Blocks are
 * auto-placed by type (board_top_n and league_card in the main column; about,
 * text, links, and favorites in the sidebar) and otherwise keep their list order.
 * DOM order is main column then sidebar, which matches the left-to-right visual
 * order, so screen-reader order equals visual order.
 *
 * At the compact breakpoint (below lg), the sidebar collapses into an accessible
 * "Profile info" drawer instead of stacking below the main column (Phase 6, an
 * intentional change from the Phase 5 stacking). SidebarShell owns that switch
 * and renders the sidebar blocks exactly once. When there are no sidebar blocks
 * the shell is skipped and the main column stands alone, unchanged.
 */
function SidebarLayout({
  handle,
  accent,
  blocks,
  wall,
}: {
  handle: string;
  accent: string;
  blocks: ResolvedBlock[];
  wall: React.ReactNode;
}) {
  const mainBlocks = blocks.filter((b) => blockColumn(b.type) === "main");
  const sidebarBlocks = blocks.filter((b) => blockColumn(b.type) === "sidebar");

  const main = (
    <>
      {mainBlocks.map((block) => renderBlock(block, handle, accent))}
      {wall}
    </>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      {sidebarBlocks.length > 0 ? (
        <SidebarShell
          main={main}
          sidebar={sidebarBlocks.map((block) => renderBlock(block, handle, accent))}
        />
      ) : (
        <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
          <div>{main}</div>
        </div>
      )}
    </div>
  );
}

type SpotlightStats = {
  boards: number;
  leagues: number;
  favoriteTeam: string | null;
  posts: number;
};

/**
 * Layout C "Spotlight": a centered, single-column landing page. The about block
 * (if present) becomes a centered editorial lede under the hero; every other
 * block renders, in the owner's order, inside a luminous BeaconCard; a wrapping
 * stats strip summarizes the profile; and the Wall sits behind a labeled
 * disclosure rather than running as a feed.
 *
 * It reads the same resolved bundle.blocks as Layouts A and B (one presentational
 * path, existing block components, caches, and graceful degrade all reused). DOM
 * order equals visual order because there is exactly one column.
 */
function SpotlightLayout({
  handle,
  accent,
  blocks,
  wall,
  stats,
}: {
  handle: string;
  accent: string;
  blocks: ResolvedBlock[];
  wall: React.ReactNode;
  stats: SpotlightStats;
}) {
  const aboutBlock = blocks.find((b) => b.type === "about");
  const lede = aboutBlock?.type === "about" ? aboutBlock.bio : null;
  const cardBlocks = blocks.filter((b) => b.type !== "about");

  return (
    <div className="mx-auto max-w-2xl px-4 sm:px-6">
      {lede && (
        <p className="mx-auto max-w-prose py-6 text-center text-lg leading-relaxed text-ink">
          {lede}
        </p>
      )}

      <StatsStrip stats={stats} />

      {cardBlocks.length > 0 && (
        <div className="flex flex-col gap-6 py-2">
          {cardBlocks.map((block) => (
            <BeaconCard key={block.id} accent={accent}>
              {renderBlock(block, handle, accent)}
            </BeaconCard>
          ))}
        </div>
      )}

      {stats.posts > 0 && (
        <div className="mt-2">
          <WallDisclosure postCount={stats.posts}>{wall}</WallDisclosure>
        </div>
      )}
    </div>
  );
}

/**
 * Spotlight stats strip: a wrapping (never horizontally scrolling) row of static
 * tiles built entirely from data already in the profile bundle, so it adds no
 * query. Renders nothing when there is nothing to show.
 */
function StatsStrip({ stats }: { stats: SpotlightStats }) {
  const items: { label: string; value: string }[] = [];
  if (stats.boards > 0) {
    items.push({
      label: stats.boards === 1 ? "Ranking board" : "Ranking boards",
      value: String(stats.boards),
    });
  }
  if (stats.leagues > 0) {
    items.push({
      label: stats.leagues === 1 ? "League" : "Leagues",
      value: String(stats.leagues),
    });
  }
  if (stats.favoriteTeam) {
    items.push({ label: "Favorite team", value: stats.favoriteTeam });
  }
  if (stats.posts > 0) {
    items.push({
      label: stats.posts === 1 ? "Wall post" : "Wall posts",
      value: String(stats.posts),
    });
  }
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="signal-spotlight-stats" className="py-6">
      <h2 id="signal-spotlight-stats" className="sr-only">
        Profile stats
      </h2>
      <dl className="flex flex-wrap justify-center gap-3">
        {items.map((item) => (
          <div
            key={item.label}
            className="min-w-24 rounded-card border border-line bg-base/50 px-4 py-3 text-center"
          >
            <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
              {item.label}
            </dt>
            <dd className="mt-1 text-lg font-semibold text-ink">{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
