import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { SITE } from "@/lib/site";
import { loadFeed, loadSidebar, BRIEF_PAGE_SIZE } from "@/lib/beacon-brief-feed";
import { BriefFeed } from "@/components/beacon-brief/brief-feed";

const TITLE = "The Beacon Brief: Fantasy Football News and Analysis";
const DESCRIPTION =
  "The Beacon Brief is FF Beacon's fantasy football news desk: injuries, transactions, depth chart shifts, suspensions, and rookie news, written in plain English with the fantasy impact spelled out.";

type PageProps = { searchParams: Promise<{ page?: string }> };

function parsePage(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const { page } = await searchParams;
  const currentPage = parsePage(page);
  const canonical = currentPage > 1 ? `${SITE.url}/brief?page=${currentPage}` : `${SITE.url}/brief`;
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical },
    openGraph: {
      title: TITLE,
      description: DESCRIPTION,
      url: canonical,
      siteName: SITE.name,
      type: "website",
    },
    twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  };
}

export default async function BriefIndexPage({ searchParams }: PageProps) {
  const { page } = await searchParams;
  const currentPage = parsePage(page);
  const supabase = await createClient();

  const [sidebarData, feed] = await Promise.all([
    loadSidebar(supabase),
    loadFeed(supabase, { kind: "all" }, currentPage),
  ]);

  return (
    <BriefFeed
      eyebrow="The Beacon Brief"
      heading="Fantasy football news that tells you what it means."
      description="Every break, trade, and role change that moves fantasy value, explained in plain English. Filter by category, tag, player, or team to see only what you care about."
      breadcrumb={[{ label: "The Beacon Brief", href: "/brief" }]}
      sidebarData={sidebarData}
      active={{ type: "all" }}
      articles={feed.articles}
      total={feed.total}
      currentPage={currentPage}
      pageSize={BRIEF_PAGE_SIZE}
      basePath="/brief"
    />
  );
}
