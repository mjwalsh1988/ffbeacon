import type { Metadata } from "next";
import { pageShareMetadata } from "@/lib/page-og";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SITE } from "@/lib/site";
import {
  loadFeed,
  loadSidebar,
  resolveTeam,
  articleIdsForTeam,
  BRIEF_PAGE_SIZE,
} from "@/lib/beacon-brief-feed";
import { BriefFeed } from "@/components/beacon-brief/brief-feed";

type PageProps = {
  params: Promise<{ abbr: string }>;
  searchParams: Promise<{ page?: string }>;
};

function parsePage(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { abbr } = await params;
  const { page } = await searchParams;
  const supabase = await createClient();
  const team = await resolveTeam(supabase, abbr);
  if (!team) return { title: "Team not found" };

  const currentPage = parsePage(page);
  const base = `${SITE.url}/brief/team/${team.abbreviation}`;
  const canonical = currentPage > 1 ? `${base}?page=${currentPage}` : base;
  const title = `${team.name} News - The Beacon Brief`;
  const description = `The latest ${team.name} fantasy football news and analysis from The Beacon Brief.`;
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

export default async function BriefTeamPage({ params, searchParams }: PageProps) {
  const { abbr } = await params;
  const { page } = await searchParams;
  const currentPage = parsePage(page);
  const supabase = await createClient();

  const team = await resolveTeam(supabase, abbr);
  if (!team) notFound();

  const ids = await articleIdsForTeam(supabase, team.id);
  const [sidebarData, feed] = await Promise.all([
    loadSidebar(supabase),
    loadFeed(supabase, { kind: "ids", articleIds: ids }, currentPage),
  ]);

  return (
    <BriefFeed
      eyebrow="Team coverage"
      heading={team.name}
      description={`Every Beacon Brief article about the ${team.name}, newest first.`}
      breadcrumb={[
        { label: "The Beacon Brief", href: "/brief" },
        { label: team.name },
      ]}
      sidebarData={sidebarData}
      active={{ type: "team", value: team.abbreviation }}
      articles={feed.articles}
      total={feed.total}
      currentPage={currentPage}
      pageSize={BRIEF_PAGE_SIZE}
      basePath={`/brief/team/${team.abbreviation}`}
    />
  );
}
