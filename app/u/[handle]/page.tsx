import type { Metadata } from "next";
import { buildProfileMetadata, ProfileView } from "@/components/signal/profile-view";

// The Wall is read live (not cached) so new posts and moderation take effect
// immediately, so this route renders dynamically. The heavy identity bundle is
// still served from its own unstable_cache data cache (tagged signal:{handle}),
// so a dynamic render only adds one indexed posts query per request.
export const dynamic = "force-dynamic";

// Legacy alias. The render lives in components/signal/profile-view.tsx and is
// shared byte-for-byte with the root /{handle} route. While /u is canonical
// (Phase 7 Stage B), canonicalBase is "/u"; Stage C flips this to a 301 shim.
const CANONICAL_BASE = "/u";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  return buildProfileMetadata((await params).handle, {
    canonicalBase: CANONICAL_BASE,
  });
}

export default async function SignalProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  return <ProfileView rawHandle={(await params).handle} canonicalBase={CANONICAL_BASE} />;
}
