import { Suspense } from "react";
import { cookies } from "next/headers";
import Link from "next/link";
import { HeaderShell } from "@/components/header-shell";
import { RailToggle } from "@/components/app-shell/rail-toggle";
import {
  SiteHeaderControls,
  HeaderControlsFallback,
} from "@/components/site-header-controls";

/**
 * The Supabase project ref, parsed from the same URL the client already
 * reads. Supabase's SSR helper (`@supabase/ssr`) names its auth cookie
 * `sb-<project-ref>-auth-token`, splitting a long token across
 * `sb-<ref>-auth-token.0`, `sb-<ref>-auth-token.1` and so on. Deriving the
 * exact prefix from this project's own URL, rather than testing any cookie
 * shaped like `sb-*-auth-token`, means a stray Supabase cookie from a
 * different project on the same hostname cannot mark this reader as signed in.
 */
function supabaseAuthCookiePrefix(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    const projectRef = new URL(url).hostname.split(".")[0];
    return projectRef ? `sb-${projectRef}-auth-token` : null;
  } catch {
    return null;
  }
}

/**
 * A HINT for layout only: does this request carry a cookie shaped like this
 * project's Supabase auth token. Nothing more.
 *
 * `await cookies()` is a request-scoped read with no network round trip, so
 * this costs nothing like the ~70ms auth call this whole Suspense split
 * (PERF-T021, see the comment on SiteHeader below) exists to defer. It can
 * still be wrong in both directions: the cookie can be stale (signed out
 * elsewhere, expired) or forged (cookies are client-writable), so it must
 * never be used for anything except deciding which placeholder shape the
 * loading fallback reserves. The real, server-verified signed-in state still
 * comes from getNavViewer() inside the Suspense boundary, unchanged.
 */
async function likelySignedIn(): Promise<boolean> {
  const prefix = supabaseAuthCookiePrefix();
  if (!prefix) return false;
  const cookieStore = await cookies();
  return cookieStore.getAll().some((c) => c.name.startsWith(prefix));
}

/**
 * The header's synchronous frame (PERF-T021). Everything below renders with no
 * await: the brand cell and the rail toggle need no database or auth read, so
 * they belong outside the Suspense boundary and stream immediately regardless
 * of how long the header's data-backed controls take.
 *
 * Every control that needs a read (the format/source toggles, search, Ask
 * BEAM, donate, the mobile nav trigger and drawer, and the signed-in/signed-out
 * account controls) lives in components/site-header-controls.tsx and renders
 * inside the Suspense boundary below. Before this split, app/layout.tsx:82
 * rendered SiteHeader with no boundary at all, so the slowest of those reads
 * (the per-reader auth round trip, about 70ms for a signed-in reader) sat in
 * front of every page's own data, including pages that are otherwise static
 * text. See docs/performance/site-speed-audit-and-plan.md section 4.2.
 *
 * This split does not make any route static. components/site-header-controls.tsx
 * still reads cookies() several times over (directly in readCookieSlug, and
 * transitively through createClient and getNavViewer), and this project has no
 * `experimental.ppr` in next.config.ts. Without partial prerendering, a
 * dynamic API call anywhere in the tree opts the whole route out of static
 * rendering no matter which Suspense boundary it sits behind; the boundary
 * only changes when the HTML for this piece streams relative to the rest of
 * the page, not whether the route as a whole is static or dynamic.
 *
 * This component is `async` so it can read that cookie hint before choosing a
 * fallback shape. That is NOT a regression of PERF-T021: `await cookies()` is
 * not a network call, and the thing this split removed was the AUTH ROUND
 * TRIP inside getNavViewer, which still happens only inside the Suspense
 * boundary below, exactly as before.
 */
export async function SiteHeader() {
  const authedHint = await likelySignedIn();
  return (
    <HeaderShell>
      {/* Brand cell. Its width tracks the navigation rail below it, so the logo
          and the rail read as one piece of chrome: narrow the rail and only the
          mark is left, widen it and the wordmark comes back. */}
      <div className="app-header-brand flex h-full shrink-0 items-center justify-center border-r border-line px-3">
        <Link
          href="/"
          aria-label="FF Beacon home"
          className="flex min-w-0 items-center gap-2.5 rounded-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/img/ff-beacon-mark-96.png"
            alt=""
            width={34}
            height={34}
            style={{ width: 34, height: 34 }}
            className="shrink-0"
          />
          <span
            aria-hidden="true"
            className="app-header-wordmark truncate bg-clip-text text-lg font-semibold text-transparent"
            style={{
              backgroundImage:
                "linear-gradient(90deg, #FFFFFF 0%, #FFFFFF 55%, #EDE6FF 85%, #DDD0FF 100%)",
            }}
          >
            FF Beacon
          </span>
        </Link>
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-2 px-3 sm:px-4 lg:px-6">
        <RailToggle />
        <Suspense
          fallback={<HeaderControlsFallback likelySignedIn={authedHint} />}
        >
          <SiteHeaderControls />
        </Suspense>
      </div>
    </HeaderShell>
  );
}
