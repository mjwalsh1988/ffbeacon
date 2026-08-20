import Link from "next/link";
import { serializeJsonLd } from "@/lib/json-ld";
import { FolderOpen, Newspaper, Shield, Tag, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SITE } from "@/lib/site";
import type { BriefSidebarData, FeedArticle } from "@/lib/beacon-brief-feed";
import { ArticleCard } from "@/components/beacon-brief/article-card";
import { BriefSidebar, type BriefActiveFilter } from "@/components/beacon-brief/brief-sidebar";
import { BriefShell } from "@/components/beacon-brief/brief-shell";
import { BriefRailSections } from "@/components/beacon-brief/brief-rail-sections";
import { BriefPagination } from "@/components/beacon-brief/brief-pagination";
import { DiscordCtaSection } from "@/components/discord-cta-section";
import { PageBody } from "@/components/app-shell/page-body";
import {
  PageMasthead,
  type MastheadChip,
  type MastheadStat,
} from "@/components/app-shell/page-masthead";
import { SetBreadcrumbLabel } from "@/components/app-shell/breadcrumb-label";
import { isDiscordMember } from "@/lib/discord-membership";

export type Breadcrumb = { label: string; href?: string };

/** The icon that names each filter view in the masthead chip row. */
const FILTER_ICONS: Record<BriefActiveFilter["type"], LucideIcon | undefined> = {
  all: undefined,
  category: FolderOpen,
  tag: Tag,
  player: User,
  team: Shield,
};

/**
 * Shared renderer for every Beacon Brief listing page (the index and the
 * category / tag / player / team filter views). Routes resolve their filter and
 * data, then hand it here so the masthead, sidebar, card grid, and pagination
 * stay identical across all of them.
 *
 * The visible breadcrumb comes from the app shell's shared bar, which derives it
 * from the pathname. The `breadcrumb` prop is still read here because these
 * routes publish their own BreadcrumbList structured data and the shared bar
 * stands down on them (see OWN_JSON_LD in lib/breadcrumbs.ts).
 */
export async function BriefFeed({
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

  // Confirmed Discord members already have the community; point the closing CTA
  // at the tools instead of the invite.
  const isMember = await isDiscordMember();

  // The masthead states which view you are in and how much is in it. On the
  // unfiltered index the eyebrow already says "The Beacon Brief", so the chip
  // would repeat it; every filtered view gets one naming the filter.
  const chips: MastheadChip[] =
    active.type === "all"
      ? []
      : [{ label: eyebrow, icon: FILTER_ICONS[active.type], tone: "cyan" }];

  const stats: MastheadStat[] = [
    { label: "Articles", value: String(total), accent: "cyan" },
  ];
  if (totalPages > 1) {
    stats.push({
      label: "Page",
      value: `${currentPage} of ${totalPages}`,
      accent: "purple",
    });
  }

  // BreadcrumbList structured data. The shared bar draws Home as the FF Beacon
  // logo; the structured data spells it out as a first item so the full path is
  // expressed for search engines.
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

  // The shared breadcrumb bar derives its trail from the pathname, which turns
  // "kc" into "KC" and "ja-marr-chase" into "Ja Marr Chase". The written label
  // for this view is already sitting in the trail we build for the JSON-LD, so
  // hand the last node of it to the bar.
  const currentCrumbLabel = breadcrumb[breadcrumb.length - 1]?.label ?? null;

  return (
    <main id="main">
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbLd) }}
      />
      {currentCrumbLabel && <SetBreadcrumbLabel value={currentCrumbLabel} />}
      {/* The Brief's categories go into the site rail, under the Brief's own
          row, rather than into the filter rail beside the articles. */}
      <BriefRailSections
        categories={sidebarData.categories}
        isIndex={active.type === "all"}
        activeCategorySlug={active.type === "category" ? active.value : null}
      />

      <PageBody flush>
        <PageMasthead
          eyebrow="The Beacon Brief"
          title={heading}
          description={description}
          chips={chips}
          stats={stats}
        />
      </PageBody>

      <BriefShell
        sidebar={<BriefSidebar data={sidebarData} active={active} />}
        categories={sidebarData.categories}
        isIndex={active.type === "all"}
        activeCategorySlug={active.type === "category" ? active.value : null}
        // `heading` is the written name of the view ("Ja'Marr Chase", "Kansas
        // City Chiefs"), which is what the Filter control should read on a
        // player, team, or tag page.
        activeFilterLabel={
          active.type === "player" || active.type === "team" || active.type === "tag"
            ? heading
            : null
        }
      >
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
        isMember={isMember}
        memberHeading="Caught up on the news? Put it to work."
        memberBody="You're already part of the crew, so we'll skip the invite. Carry the latest into the free FF Beacon tools and turn headlines into lineup calls."
      />
    </main>
  );
}
