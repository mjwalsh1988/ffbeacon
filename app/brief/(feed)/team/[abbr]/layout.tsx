import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveTeam } from "@/lib/beacon-brief-feed";

/**
 * Decides whether the team exists BEFORE ./loading.tsx.
 *
 * A layout renders outside the loading boundary of its own segment, so a
 * notFound() here goes out as a real 404. The same check in ./page.tsx runs
 * after the loader has already been sent with a 200. The segment is bounded
 * the same way the page bounds it (two to four letters), so anything else costs
 * no read; resolveTeam is memoised, so the page's own call is not a second one.
 */
export default async function BriefTeamLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ abbr: string }>;
}) {
  const { abbr } = await params;
  const code = abbr.slice(0, 4).toUpperCase();
  if (!/^[A-Z]{2,4}$/.test(code)) notFound();
  const team = await resolveTeam(await createClient(), code);
  if (!team) notFound();
  return children;
}
