import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { createCachedReadClient } from "@/lib/supabase/server";
import { getActiveFormats } from "@/lib/source";

/**
 * Decides whether a format board exists, BEFORE the loading boundary.
 *
 * A layout renders outside the loading.tsx of its own segment, so a notFound()
 * here is thrown while nothing has been sent and the response is a real 404.
 * The same call in ./page.tsx runs under ./loading.tsx, after the loader has
 * already gone out with a 200. The page keeps its own check; this one only has
 * to be first.
 *
 * format_configs is public and small, and the cookie-free client matches what
 * the page's own activeFormat() uses.
 */
export default async function FormatBoardLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ format: string }>;
}) {
  const { format: slug } = await params;
  const formats = await getActiveFormats(createCachedReadClient());
  if (!formats.some((f) => f.slug === slug)) notFound();
  return children;
}
