import type { ReactNode } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createCachedReadClient } from "@/lib/supabase/server";
import { lookupSleeperLeague } from "@/lib/sleeper";

/**
 * Decides whether a league exists BEFORE ./loading.tsx.
 *
 * A layout renders outside the loading boundary of its own segment, so a
 * notFound() here goes out as a real 404. The branded loader used to sit one
 * level up (app/leagues/loading.tsx), above every check, so a league id that
 * does not exist answered 200 with the not-found body. Every missing page must
 * be a real 404, so the loader moved into this segment and the question moved
 * here.
 *
 * Three answers, cheapest first:
 *
 * 1. Not a Sleeper league id at all (they are digit strings, 19 digits today):
 *    404 with no read.
 * 2. A league we already hold: exists. One indexed read.
 * 3. A league we have never stored: ask Sleeper, and 404 ONLY when Sleeper
 *    answers that the league does not exist. A failed request is not evidence
 *    about a league (CLAUDE.md, League Pulse), so it falls through to the page,
 *    which already renders the branded retry state for a sync failure.
 *
 * Step 3 is skipped on a router prefetch. A league list prefetches every link
 * in view, most of them leagues we have never stored, and a Sleeper request per
 * visible link would spend the site's call budget on pages nobody opened. A
 * prefetch is never what a crawler receives, so it never needed a status.
 *
 * The pages under this segment keep their own checks (a missing team, a week
 * out of range); those still run under the loader.
 */
const SLEEPER_LEAGUE_ID = /^\d{1,32}$/;
const LAYOUT_LOOKUP_TIMEOUT_MS = 3_000;

export default async function LeagueLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ league_id: string }>;
}) {
  const { league_id: sleeperLeagueId } = await params;
  if (!SLEEPER_LEAGUE_ID.test(sleeperLeagueId)) notFound();

  const { data: stored } = await createCachedReadClient()
    .from("leagues")
    .select("id")
    .eq("sleeper_league_id", sleeperLeagueId)
    .limit(1)
    .maybeSingle();
  if (stored) return children;

  const requestHeaders = await headers();
  if (requestHeaders.get("next-router-prefetch")) return children;

  // A short deadline: this runs BEFORE the branded loader can paint, so a slow
  // Sleeper must not hold a blank screen. A timeout is "failed", which falls
  // through to the page and its own retry state, never to a 404.
  const lookup = await lookupSleeperLeague(sleeperLeagueId, LAYOUT_LOOKUP_TIMEOUT_MS);
  if (lookup.status === "not_found") notFound();
  return children;
}
