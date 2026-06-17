import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { normalizeHandle, validateHandleFormat } from "@/lib/signal";
import { isReservedRouteSegment } from "@/lib/signal/reserved-routes";
import { buildProfileMetadata, ProfileView } from "@/components/signal/profile-view";

// Root /{handle} alias for Signal profiles (Phase 7), so a profile reads as a
// standalone website. The render is shared byte-for-byte with /u/{handle} via
// components/signal/profile-view.tsx.
//
// This is a root dynamic segment, NOT a middleware rewrite. Next.js route
// precedence means every literal top-level route (/rankings, /players, /api,
// ...) is matched by its own folder and never reaches this segment, so a handle
// can never shadow a real route. This catch-all is reached only when no literal
// route matches a single-segment path.
//
// Two in-process guards before any profile load:
//   1. validateHandleFormat: anything that is not ^[a-z0-9_]{3,30}$ (dots,
//      hyphens, uppercase, multi-segment) is not a handle -> notFound. This also
//      means file-like paths (favicon.ico, sitemap.xml) never load a profile.
//   2. isReservedRouteSegment: defense in depth so a route-segment-shaped path
//      never attempts a profile load even if reached.
export const dynamic = "force-dynamic";

// Stage B: /u is still canonical, so root renders with canonicalBase "/u" (root
// serves the same page, /u stays the canonical URL). Stage C flips this to "".
const CANONICAL_BASE = "/u";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const handle = normalizeHandle((await params).handle);
  if (validateHandleFormat(handle) !== null || isReservedRouteSegment(handle)) {
    return { title: "Profile not found", robots: { index: false, follow: false } };
  }
  return buildProfileMetadata(handle, { canonicalBase: CANONICAL_BASE });
}

export default async function RootHandlePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const rawHandle = (await params).handle;
  const handle = normalizeHandle(rawHandle);
  if (validateHandleFormat(handle) !== null || isReservedRouteSegment(handle)) {
    notFound();
  }
  return <ProfileView rawHandle={rawHandle} canonicalBase={CANONICAL_BASE} />;
}
