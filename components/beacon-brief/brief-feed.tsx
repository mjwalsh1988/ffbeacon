import Link from "next/link";
import type { ReactNode } from "react";
import { serializeJsonLd } from "@/lib/json-ld";
import { BookOpen, FolderOpen, Newspaper, Shield, Tag, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SITE } from "@/lib/site";
import type { BriefSidebarData } from "@/lib/beacon-brief-feed";
import type { LatestBrief, RelayCardData } from "@/lib/relays/load";
import { RelayCard } from "@/components/relays/relay-card";
import { RelayGrid } from "@/components/relays/relay-grid";
import { LatestBriefPanel } from "@/components/relays/latest-brief-panel";
import { BriefSidebar, type BriefActiveFilter } from "@/components/beacon-brief/brief-sidebar";
import { BriefShell } from "@/components/beacon-brief/brief-shell";
import { BriefRailSections } from "@/components/beacon-brief/brief-rail-sections";
import { BriefPagination } from "@/components/beacon-brief/brief-pagination";
import { DiscordCtaSection } from "@/components/discord-cta-section";
import { PreferredSourceLink } from "@/components/beacon-brief/preferred-source-link";
import { PageBody } from "@/components/app-shell/page-body";
import {
  PageMasthead,
  type MastheadChip,
  type MastheadStat,
} from "@/components/app-shell/page-masthead";
import { SetBreadcrumbLabel } from "@/components/app-shell/breadcrumb-label";
import { isDiscordMember } from "@/lib/discord-membership";
import { hasPublishedEditions } from "@/lib/sitemap/sections";

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
 * Shared renderer for every Beacon Brief listing page (the hub and the
 * category / tag / player / team filter views). Since the Relay pipeline
 * (docs/beacon-brief/relays-and-briefs-plan.md, section 6) the list is a feed
 * of Relay cards, newest first, with the latest Brief pinned above it on the
 * hub. Routes resolve their filter and data, then hand it here so the
 * masthead, sidebar, list, and pagination stay identical across all of them.
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
  relays,
  total,
  currentPage,
  pageSize,
  basePath,
  latestBrief = null,
  filters = null,
  emptyMessage,
  viewSwitcher = null,
  content,
  layout = "grid",
  paginated = true,
}: {
  eyebrow: string;
  heading: string;
  description: string;
  breadcrumb: Breadcrumb[];
  sidebarData: BriefSidebarData;
  active: BriefActiveFilter;
  relays: RelayCardData[];
  total: number;
  currentPage: number;
  pageSize: number;
  /** The path the page links are built on. May already carry a query string. */
  basePath: string;
  /** The newest edition, pinned above the feed on the hub only. */
  latestBrief?: LatestBrief | null;
  /** The kind and week filter form, rendered above the list. */
  filters?: ReactNode;
  /**
   * Replaces the empty state's default sentence, for a view that is empty
   * because the address named something that does not exist rather than
   * because nothing has been reported yet.
   */
  emptyMessage?: string;
  /** The hub's view links, rendered between the heading row and the filters. */
  viewSwitcher?: ReactNode;
  /**
   * Replaces the default list or grid and its pagination, for the week and
   * calendar views, which lay the reports out themselves.
   */
  content?: ReactNode;
  /** The default rendering: three compact cards across, or one full card per row. */
  layout?: "grid" | "list";
  /** False for a view with no pages (the calendar), so the masthead shows no page count. */
  paginated?: boolean;
}) {
  // The calendar has no pages, so the masthead does not claim "page 1 of 6"
  // over a month.
  const totalPages = paginated ? Math.max(1, Math.ceil(total / pageSize)) : 1;

  // Confirmed Discord members already have the community; point the closing CTA
  // at the tools instead of the invite.
  //
  // The editions listing is linked from the hub's masthead, and ONLY once an
  // edition exists. It is the one permanent internal link into that page (the
  // editions themselves are the only others), so without it the listing would
  // sit outside the site's own link graph; with it while the listing is empty
  // the hub would be advertising an under-construction screen. Same read as the
  // page's robots tag and the core sitemap entry, so the three agree.
  const [isMember, hasEditions] = await Promise.all([
    isDiscordMember(),
    active.type === "all" ? hasPublishedEditions() : Promise.resolve(false),
  ]);

  // The masthead states which view you are in and how much is in it. On the
  // unfiltered index the eyebrow already says "The Beacon Brief", so the chip
  // would repeat it; every filtered view gets one naming the filter.
  const chips: MastheadChip[] =
    active.type === "all"
      ? []
      : [{ label: eyebrow, icon: FILTER_ICONS[active.type], tone: "cyan" }];

  const stats: MastheadStat[] = [
    { label: "Reports", value: String(total), accent: "cyan" },
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
          row, rather than into the filter rail beside the reports. */}
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
          actions={
            hasEditions ? (
              <Link
                href="/brief/editions"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                <BookOpen aria-hidden="true" className="h-4 w-4" />
                Every edition of the Brief
              </Link>
            ) : undefined
          }
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
        <LatestBriefPanel brief={latestBrief} />

        <div className="mb-5 flex items-center justify-between gap-3">
          {/* The masthead title is this page's h1 and the card headlines are h3
              (relay-card.tsx), so this h2 keeps the outline from skipping a
              level. */}
          <h2 className="text-lg font-semibold text-ink">Latest reports</h2>
          {/* Plain text on purpose, with no live region. The filter form is a
              full page load, and a live region never fires for content that is
              in the initial HTML, so the attributes would be inert and a later
              reviewer would read them as an announcement that happens. The
              count sits directly under the h2 and in the masthead stat row, so
              it is the next thing read after the heading either way. */}
          <p className="text-sm text-ink-muted">
            {total === 0
              ? "No reports yet"
              : `${total} ${total === 1 ? "report" : "reports"}`}
          </p>
        </div>

        {viewSwitcher && <div className="mb-5">{viewSwitcher}</div>}

        {filters}

        {content !== undefined ? (
          content
        ) : relays.length === 0 ? (
          <div className="flex flex-col items-center rounded-modal border border-dashed border-line bg-base/40 px-6 py-16 text-center">
            <span
              aria-hidden="true"
              className="flex h-12 w-12 items-center justify-center rounded-card border border-line bg-surface text-brand-cyan"
            >
              <Newspaper className="h-6 w-6" />
            </span>
            <p className="mt-4 text-base font-semibold text-ink">Nothing here yet</p>
            <p className="mt-1 max-w-md text-sm leading-relaxed text-ink-muted">
              {emptyMessage ??
                "There are no reports for this view yet. New reports land here the moment the desk accepts them."}
            </p>
            <Link
              href="/brief"
              className="mt-6 inline-flex min-h-11 items-center rounded-card bg-beacon px-4 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Back to all reports
            </Link>
          </div>
        ) : (
          <>
            {layout === "grid" ? (
              <RelayGrid relays={relays} />
            ) : (
              <ul role="list" className="space-y-4">
                {relays.map((relay) => (
                  <li key={relay.id}>
                    <RelayCard relay={relay} />
                  </li>
                ))}
              </ul>
            )}
            <BriefPagination
              basePath={basePath}
              currentPage={currentPage}
              totalPages={totalPages}
            />
          </>
        )}
      </BriefShell>

      {/* Google's preferred source link on every Brief listing page (owner
          decision 2026-09-11, plan finding G05). Below the list and the
          pagination, so it never sits between a reader and the stories. */}
      <PageBody>
        <PreferredSourceLink className="border-t border-line pt-8" />
      </PageBody>

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
