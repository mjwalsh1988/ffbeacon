import Link from "next/link";
import { Newspaper } from "lucide-react";
import { SITE } from "@/lib/site";
import type { BriefSidebarData, FeedArticle } from "@/lib/beacon-brief-feed";
import { ArticleCard } from "@/components/beacon-brief/article-card";
import { BriefSidebar, type BriefActiveFilter } from "@/components/beacon-brief/brief-sidebar";
import { BriefShell } from "@/components/beacon-brief/brief-shell";
import { BriefBreadcrumb } from "@/components/beacon-brief/brief-breadcrumb";
import { BriefPagination } from "@/components/beacon-brief/brief-pagination";
import { DiscordCtaSection } from "@/components/discord-cta-section";

export type Breadcrumb = { label: string; href?: string };

/**
 * Shared renderer for every Beacon Brief listing page (the index and the
 * category / tag / player / team filter views). Routes resolve their filter and
 * data, then hand it here so the header, breadcrumb, sidebar, card grid, and
 * pagination stay identical across all of them.
 */
export function BriefFeed({
  eyebrow,
  heading,
  description,
  breadcrumb,
  sidebarData,
  active,
  articles,
  total,
  currentPage,
  pageSize,
  basePath,
}: {
  eyebrow: string;
  heading: string;
  description: string;
  breadcrumb: Breadcrumb[];
  sidebarData: BriefSidebarData;
  active: BriefActiveFilter;
  articles: FeedArticle[];
  total: number;
  currentPage: number;
  pageSize: number;
  basePath: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // BreadcrumbList structured data. The visible trail leads with the FF Beacon
  // logo (the Beacon Brief home); the structured data prepends the site Home so
  // the full path is expressed for search engines.
  const breadcrumbTrail: Breadcrumb[] = [{ label: "Home", href: "/" }, ...breadcrumb];
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: breadcrumbTrail.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.label,
      ...(c.href ? { item: `${SITE.url}${c.href}` } : {}),
    })),
  };

  return (
    <main id="main">
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />

      <header className="relative overflow-hidden border-b border-line">
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px"
          style={{
            backgroundImage:
              "linear-gradient(90deg, transparent 0%, #A855F7 35%, #22D3EE 65%, transparent 100%)",
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-28 left-1/2 h-[360px] w-[760px] -translate-x-1/2"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(168, 85, 247, 0.16) 0%, rgba(34, 211, 238, 0.09) 45%, transparent 75%)",
          }}
        />
        <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
          <BriefBreadcrumb crumbs={breadcrumb} className="mb-4" />

          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
            {eyebrow}
          </p>
          <h1 className="max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl md:text-5xl">
            {heading}
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-muted sm:text-lg">
            {description}
          </p>
        </div>
      </header>

      <BriefShell sidebar={<BriefSidebar data={sidebarData} active={active} />}>
        <div className="mb-5 flex items-center justify-between gap-3">
          <p className="text-sm text-ink-muted" role="status">
            {total === 0
              ? "No articles yet"
              : `${total} ${total === 1 ? "article" : "articles"}`}
          </p>
        </div>

        {articles.length === 0 ? (
          <div className="flex flex-col items-center rounded-modal border border-dashed border-line bg-base/40 px-6 py-16 text-center">
            <span
              aria-hidden="true"
              className="flex h-12 w-12 items-center justify-center rounded-card border border-line bg-surface text-brand-cyan"
            >
              <Newspaper className="h-6 w-6" />
            </span>
            <p className="mt-4 text-base font-semibold text-ink">Nothing here yet</p>
            <p className="mt-1 max-w-md text-sm leading-relaxed text-ink-muted">
              There are no published articles for this view yet. New coverage
              lands here the moment it publishes.
            </p>
            <Link
              href="/brief"
              className="mt-6 inline-flex min-h-11 items-center rounded-card bg-beacon px-4 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Back to all articles
            </Link>
          </div>
        ) : (
          <>
            <ul role="list" className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {articles.map((article) => (
                <li key={article.slug}>
                  <ArticleCard article={article} />
                </li>
              ))}
            </ul>
            <BriefPagination
              basePath={basePath}
              currentPage={currentPage}
              totalPages={totalPages}
            />
          </>
        )}
      </BriefShell>

      <DiscordCtaSection
        eyebrow="Talk about the news"
        heading="Got questions about what this means for your team?"
        body="Drop into our Discord and real fantasy players will help you turn this news into a lineup decision, free. Want to know what's behind FF Beacon? Read about the project."
        className="border-t border-line"
      />
    </main>
  );
}
