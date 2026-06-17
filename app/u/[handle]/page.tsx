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
} from "@/lib/signal-profile";
import {
  loadWallPosts,
  loadReactionsForTargets,
  type WallPost,
  type WallReactions,
} from "@/lib/signal-wall";
import { ImageWithFallback } from "@/components/image-with-fallback";
import {
  FeaturedBoardsBlock,
  FeaturedLeaguesBlock,
  LinksBlock,
  FavoritesBlock,
} from "@/components/signal/signal-block";
import { WallBlock } from "@/components/signal/wall";

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

        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <div className="-mt-12 flex flex-col gap-4 pb-8 sm:-mt-14 sm:flex-row sm:items-end">
            <div className="rounded-full ring-4 ring-base">
              <ImageWithFallback
                src={avatar}
                alt={`${signal.display_name} avatar`}
                size={112}
              />
            </div>
            <div className="min-w-0 flex-1">
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

      {signal.bio && (
        <section
          aria-labelledby="signal-about-heading"
          className="mx-auto max-w-3xl px-4 py-8 sm:px-6"
        >
          <h2
            id="signal-about-heading"
            className="text-sm font-semibold uppercase tracking-[0.14em] text-brand-cyan"
          >
            About
          </h2>
          <p className="mt-3 whitespace-pre-line text-base leading-relaxed text-ink">
            {signal.bio}
          </p>
        </section>
      )}

      <FavoritesBlock favorites={bundle.favorites} accent={signal.accent} />
      <FeaturedBoardsBlock handle={signal.handle} boards={bundle.boards} />
      <FeaturedLeaguesBlock leagues={bundle.leagues} />
      <LinksBlock links={bundle.links} accent={signal.accent} />
      <WallBlock
        posts={posts}
        ownerPreview={ownerPreview}
        viewerUserId={viewerUserId}
        viewerIsAdmin={viewerIsAdmin}
        viewerIsWallOwner={viewerIsWallOwner}
        reactions={reactions}
      />
    </main>
  );
}
