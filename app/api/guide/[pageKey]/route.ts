import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPublishedGuideContent } from "@/lib/guide/queries";

/**
 * GET /api/guide/[pageKey]
 *
 * Public read endpoint backing the floating Signal Guide launcher. Returns a
 * page's published questions and terms (or an empty payload when the page is
 * unknown or has nothing published, which keeps the launcher hidden).
 *
 * Public on purpose: the guide shows for anonymous and signed-in visitors alike,
 * so there is no auth gate. The anon server client enforces the guide_entries
 * public RLS policy (published rows only); the query also filters is_published
 * explicitly. No user-specific data is returned, so the response is cacheable at
 * the edge.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ pageKey: string }> },
) {
  const { pageKey } = await params;

  // Slug-shape guard. Anything else can't be a real page_key, so short-circuit.
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(pageKey) || pageKey.length > 60) {
    return NextResponse.json(
      { page: null, questions: [], terms: [] },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } },
    );
  }

  const supabase = await createClient();
  const content = await getPublishedGuideContent(supabase, pageKey);

  return NextResponse.json(
    content ?? { page: null, questions: [], terms: [] },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } },
  );
}
