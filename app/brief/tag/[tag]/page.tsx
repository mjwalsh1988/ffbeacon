import type { Metadata } from "next";
import { pageShareMetadata } from "@/lib/page-og";
import { createClient } from "@/lib/supabase/server";
import { SITE } from "@/lib/site";
import { loadFeed, loadSidebar, BRIEF_PAGE_SIZE } from "@/lib/beacon-brief-feed";
import { BriefFeed } from "@/components/beacon-brief/brief-feed";

type PageProps = {
  params: Promise<{ tag: string }>;
  searchParams: Promise<{ page?: string }>;
};

function parsePage(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** URL-decode the tag segment. Tags are stored as free text (mixed case, spaces)
 * and encoded with encodeURIComponent when linked, so decode to match. */
function decodeTag(raw: string): string {
  try {
    return decodeURIComponent(raw).slice(0, 80);
  } catch {
    return raw.slice(0, 80);
  }
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { tag: rawTag } = await params;
  const { page } = await searchParams;
  const tag = decodeTag(rawTag);
  const currentPage = parsePage(page);
  const base = `${SITE.url}/brief/tag/${encodeURIComponent(tag)}`;
  const canonical = currentPage > 1 ? `${base}?page=${currentPage}` : base;
  const title = `${tag} - The Beacon Brief`;
  const description = `Fantasy football articles tagged "${tag}" from The Beacon Brief.`;
  return {
    title,
    description,
    alternates: { canonical },
    // Filtered views of the Brief share the Brief's own card. The headline
    // and the description below still name the filter, so the preview reads
    // correctly even though the artwork is the section's.
    ...pageShareMetadata({ key: "brief", title, description, path: "/brief" }),
  };
}

export default async function BriefTagPage({ params, searchParams }: PageProps) {
  const { tag: rawTag } = await params;
  const { page } = await searchParams;
  const tag = decodeTag(rawTag);
  const currentPage = parsePage(page);
  const supabase = await createClient();

  const [sidebarData, feed] = await Promise.all([
    loadSidebar(supabase),
    loadFeed(supabase, { kind: "tag", tag }, currentPage),
  ]);

  return (
    <BriefFeed
      eyebrow="Tag"
      heading={tag}
      description={`Every Beacon Brief article tagged "${tag}", newest first.`}
      breadcrumb={[
        { label: "The Beacon Brief", href: "/brief" },
        { label: tag },
      ]}
      sidebarData={sidebarData}
      active={{ type: "tag", value: tag }}
      articles={feed.articles}
      total={feed.total}
      currentPage={currentPage}
      pageSize={BRIEF_PAGE_SIZE}
      basePath={`/brief/tag/${encodeURIComponent(tag)}`}
    />
  );
}
