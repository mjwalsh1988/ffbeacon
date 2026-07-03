import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SITE } from "@/lib/site";
import {
  loadFeed,
  loadSidebar,
  resolvePlayer,
  articleIdsForPlayer,
  BRIEF_PAGE_SIZE,
} from "@/lib/beacon-brief-feed";
import { BriefFeed } from "@/components/beacon-brief/brief-feed";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
};

function parsePage(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const { page } = await searchParams;
  const supabase = await createClient();
  const player = await resolvePlayer(supabase, slug);
  if (!player) return { title: "Player not found" };

  const currentPage = parsePage(page);
  const base = `${SITE.url}/brief/player/${slug}`;
  const canonical = currentPage > 1 ? `${base}?page=${currentPage}` : base;
  const title = `${player.name} News - The Beacon Brief`;
  const description = `The latest fantasy football news and analysis on ${player.name} from The Beacon Brief.`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, siteName: SITE.name, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function BriefPlayerPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { page } = await searchParams;
  const currentPage = parsePage(page);
  const supabase = await createClient();

  const player = await resolvePlayer(supabase, slug);
  if (!player) notFound();

  const ids = await articleIdsForPlayer(supabase, player.id);
  const [sidebarData, feed] = await Promise.all([
    loadSidebar(supabase),
    loadFeed(supabase, { kind: "ids", articleIds: ids }, currentPage),
  ]);

  const posTeam = [player.position, player.team].filter(Boolean).join(", ");

  return (
    <BriefFeed
      eyebrow="Player coverage"
      heading={player.name}
      description={`Every Beacon Brief article that mentions ${player.name}${posTeam ? ` (${posTeam})` : ""}, newest first.`}
      breadcrumb={[
        { label: "The Beacon Brief", href: "/brief" },
        { label: player.name },
      ]}
      sidebarData={sidebarData}
      active={{ type: "player", value: slug }}
      articles={feed.articles}
      total={feed.total}
      currentPage={currentPage}
      pageSize={BRIEF_PAGE_SIZE}
      basePath={`/brief/player/${slug}`}
    />
  );
}
