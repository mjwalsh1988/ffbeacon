import type { Metadata } from "next";
import { pageShareMetadata } from "@/lib/page-og";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SITE } from "@/lib/site";
import {
  loadFeed,
  loadSidebar,
  resolveCategory,
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
  const category = await resolveCategory(supabase, slug);
  if (!category) return { title: "Category not found" };

  const currentPage = parsePage(page);
  const base = `${SITE.url}/brief/category/${slug}`;
  const canonical = currentPage > 1 ? `${base}?page=${currentPage}` : base;
  const title = `${category.name} News - The Beacon Brief`;
  const description =
    category.description ??
    `The latest ${category.name.toLowerCase()} news for fantasy football from The Beacon Brief.`;
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

export default async function BriefCategoryPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const { page } = await searchParams;
  const currentPage = parsePage(page);
  const supabase = await createClient();

  const category = await resolveCategory(supabase, slug);
  if (!category) notFound();

  const [sidebarData, feed] = await Promise.all([
    loadSidebar(supabase),
    loadFeed(supabase, { kind: "category", categoryId: category.id }, currentPage),
  ]);

  return (
    <BriefFeed
      eyebrow="Category"
      heading={category.name}
      description={
        category.description ??
        `The latest ${category.name.toLowerCase()} coverage from The Beacon Brief.`
      }
      breadcrumb={[
        { label: "The Beacon Brief", href: "/brief" },
        { label: category.name },
      ]}
      sidebarData={sidebarData}
      active={{ type: "category", value: slug }}
      articles={feed.articles}
      total={feed.total}
      currentPage={currentPage}
      pageSize={BRIEF_PAGE_SIZE}
      basePath={`/brief/category/${slug}`}
    />
  );
}
