import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolvePlayer } from "@/lib/beacon-brief-feed";

/**
 * Decides whether the player exists BEFORE ./loading.tsx.
 *
 * A layout renders outside the loading boundary of its own segment, so a
 * notFound() here goes out as a real 404. The same check in ./page.tsx runs
 * after the loader has already been sent with a 200. Same slug bound as the
 * page (80 characters).
 */
export default async function BriefPlayerLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const player = await resolvePlayer(await createClient(), slug.slice(0, 80));
  if (!player) notFound();
  return children;
}
