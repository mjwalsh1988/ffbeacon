import { cache } from "react";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SITE } from "@/lib/site";
import { accentGradient } from "@/lib/signal";
import { ImageWithFallback } from "@/components/image-with-fallback";

const BUCKET = "signal-media";

type SignalRow = {
  user_id: string;
  handle: string;
  display_name: string;
  headline: string | null;
  bio: string | null;
  accent: string;
  avatar_path: string | null;
  banner_path: string | null;
  status: "draft" | "published";
  visibility: "public" | "private";
  hidden: boolean;
};

function publicUrl(path: string | null): string | null {
  if (!path) return null;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

// RLS returns the row when it is published+public (any viewer) or owned by the
// current viewer (owner preview of a draft/private profile). cache() dedupes the
// query between generateMetadata and the page within a single request.
const loadSignal = cache(async (handle: string): Promise<SignalRow | null> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("signals")
    .select(
      "user_id, handle, display_name, headline, bio, accent, avatar_path, banner_path, status, visibility, hidden",
    )
    .eq("handle", handle)
    .maybeSingle();
  return (data as SignalRow | null) ?? null;
});

// If the handle is a former handle of a still-viewable profile, return the
// current handle so the page can 301 to it. Private/draft targets resolve to
// null (we never reveal them via redirect).
async function resolveHistoricalHandle(handle: string): Promise<string | null> {
  const supabase = await createClient();
  const { data: history } = await supabase
    .from("signal_handle_history")
    .select("signal_id")
    .eq("old_handle", handle)
    .maybeSingle();
  if (!history) return null;
  const { data: current } = await supabase
    .from("signals")
    .select("handle")
    .eq("id", history.signal_id)
    .maybeSingle();
  return current?.handle ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const raw = (await params).handle.toLowerCase();
  const signal = await loadSignal(raw);
  if (!signal) {
    return { title: "Profile not found", robots: { index: false, follow: false } };
  }

  const isLive =
    signal.status === "published" && signal.visibility === "public" && !signal.hidden;
  const title = `${signal.display_name} (@${signal.handle})`;
  const description =
    signal.headline ||
    (signal.bio ? signal.bio.slice(0, 160) : `${signal.display_name} on ${SITE.name}.`);
  const url = `${SITE.url}/u/${signal.handle}`;
  const avatar = publicUrl(signal.avatar_path);
  const images = avatar ? [{ url: avatar }] : undefined;

  return {
    title,
    description,
    alternates: { canonical: url },
    // Drafts and private profiles must never be indexed, even though the owner
    // can still load them for preview.
    robots: isLive ? undefined : { index: false, follow: false },
    openGraph: { type: "profile", title, description, url, images },
    twitter: { card: "summary", title, description, images },
  };
}

export default async function SignalProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const rawHandle = (await params).handle;
  const handle = rawHandle.toLowerCase();

  const signal = await loadSignal(handle);
  if (!signal) {
    const redirectTo = await resolveHistoricalHandle(handle);
    if (redirectTo) permanentRedirect(`/u/${redirectTo}`);
    notFound();
  }

  // Canonicalize casing: /u/Michael -> /u/michael (the stored handle).
  if (rawHandle !== signal.handle) {
    permanentRedirect(`/u/${signal.handle}`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isOwner = !!user && user.id === signal.user_id;
  const isLive =
    signal.status === "published" && signal.visibility === "public" && !signal.hidden;

  const avatar = publicUrl(signal.avatar_path);
  const banner = publicUrl(signal.banner_path);
  const gradient = accentGradient(signal.accent);

  return (
    <main id="main">
      {isOwner && !isLive && (
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
          <img
            src={banner}
            alt=""
            className="h-40 w-full object-cover sm:h-56"
          />
        ) : (
          <div aria-hidden="true" className="h-40 w-full sm:h-56" style={{ backgroundImage: gradient }} />
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
              <p className="mt-0.5 font-mono text-sm text-ink-muted">@{signal.handle}</p>
              {signal.headline && (
                <p className="mt-2 text-base leading-relaxed text-ink-muted">{signal.headline}</p>
              )}
            </div>
          </div>
        </div>
      </header>

      {signal.bio && (
        <section aria-labelledby="signal-about-heading" className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
          <h2 id="signal-about-heading" className="text-sm font-semibold uppercase tracking-[0.14em] text-brand-cyan">
            About
          </h2>
          <p className="mt-3 whitespace-pre-line text-base leading-relaxed text-ink">{signal.bio}</p>
        </section>
      )}
    </main>
  );
}
