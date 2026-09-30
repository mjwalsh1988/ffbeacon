import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveCategory } from "@/lib/beacon-brief-feed";

/**
 * Decides whether the category exists BEFORE ./loading.tsx.
 *
 * A layout renders outside the loading boundary of its own segment, so a
 * notFound() here goes out as a real 404. The same check in ./page.tsx runs
 * after the loader has already been sent with a 200. resolveCategory is
 * memoised, so the page's own call is not a second read.
 */
export default async function BriefCategoryLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const category = await resolveCategory(await createClient(), slug);
  if (!category) notFound();
  return children;
}
