import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { SITE } from "@/lib/site";
import { pageShareMetadata } from "@/lib/page-og";
import { serializeJsonLd } from "@/lib/json-ld";
import { formatEasternDate } from "@/lib/datetime";
import { createCachedReadClient } from "@/lib/supabase/server";
import { loadPublishedBriefs, type LatestBrief } from "@/lib/relays/load";
import { hasPublishedEditions } from "@/lib/sitemap/sections";
import { formatPeriod, periodLabel } from "@/lib/brief-desk/period";
import { PageBody } from "@/components/app-shell/page-body";
import { PageMasthead } from "@/components/app-shell/page-masthead";

/**
 * /brief/editions: every published Brief edition by season and week, newest
 * first (plan 11.1). Canonical to itself. Each row is the title, the dateline,
 * the period it covers and the summary.
 *
 * INDEXABLE ONLY ONCE IT LISTS SOMETHING. With no edition published this page
 * is a heading and one sentence, which is the under-construction screen
 * Google's publisher policies name and the pattern the AdSense decline was
 * about (docs/seo-audit/adsense-review-2026-09-14.md). So the robots tag, the
 * core sitemap entry (lib/sitemap/sections.ts) and the hub's link to this page
 * (components/beacon-brief/brief-feed.tsx) all hang off the SAME question,
 * asked through hasPublishedEditions(): a sitemap that advertises a noindex
 * URL teaches Google the whole file is unreliable, so those three cannot be
 * allowed to answer it differently.
 */

const TITLE = "The Beacon Brief: Every Edition";
// Under 155 characters, with the distinguishing clause first, so a search
// result does not cut off the part that says what an edition is for.
const DESCRIPTION =
  "What to do in dynasty and redraft about each period's fantasy football news, checked against the numbers. Every edition of The Beacon Brief by week.";

export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  const indexable = await hasPublishedEditions();
  return {
    title: { absolute: TITLE },
    description: DESCRIPTION,
    alternates: {
      canonical: `${SITE.url}/brief/editions`,
      types: { "application/rss+xml": [{ url: "/brief/rss.xml", title: "The Beacon Brief" }] },
    },
    // follow stays true either way, so a crawler that reaches an empty listing
    // still walks out to the hub. The preview permissions sit on the basic
    // object as well as googleBot so Bing gets the same grant.
    robots: {
      index: indexable,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      googleBot: { index: indexable, follow: true, "max-image-preview": "large", "max-snippet": -1 },
    },
    // The same 1200 by 630 share card every other indexable page gets, with
    // og:url equal to the canonical.
    ...pageShareMetadata({ key: "brief", title: TITLE, description: DESCRIPTION, path: "/brief/editions" }),
  };
}

function groupBySeason(briefs: LatestBrief[]): Array<{ season: string; briefs: LatestBrief[] }> {
  const groups = new Map<string, LatestBrief[]>();
  for (const b of briefs) {
    const key = b.season !== null ? String(b.season) : "Undated";
    const list = groups.get(key) ?? [];
    list.push(b);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([season, list]) => ({
      season,
      briefs: [...list].sort((a, b) => (b.week ?? -1) - (a.week ?? -1) || (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "")),
    }));
}

export default async function BriefEditionsPage() {
  const briefs = await loadPublishedBriefs(createCachedReadClient());
  const groups = groupBySeason(briefs);

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: TITLE,
      description: DESCRIPTION,
      url: `${SITE.url}/brief/editions`,
      inLanguage: "en-US",
      mainEntity: {
        "@type": "ItemList",
        itemListElement: briefs.map((b, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: b.title,
          url: `${SITE.url}/brief/${b.slug}`,
        })),
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE.url },
        { "@type": "ListItem", position: 2, name: "The Beacon Brief", item: `${SITE.url}/brief` },
        { "@type": "ListItem", position: 3, name: "Editions", item: `${SITE.url}/brief/editions` },
      ],
    },
  ];

  return (
    <main id="main">
      <script type="application/ld+json" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} />
      <PageBody>
        <PageMasthead
          eyebrow="The Beacon Brief"
          title="Every edition"
          description="One Brief per period, by season and week, newest first. Each one gathers the period's reports, checks them against the numbers, and says what to do."
          chips={[{ label: `${briefs.length} ${briefs.length === 1 ? "edition" : "editions"}`, icon: BookOpen, tone: "cyan" }]}
        />

        {briefs.length === 0 ? (
          <p className="mt-6 rounded-card border border-dashed border-line bg-base/40 px-6 py-10 text-center text-sm text-ink-muted">
            No edition has been published yet. The latest reports are on <Link href="/brief" className="font-semibold text-brand-cyan underline underline-offset-2">the Brief hub</Link>.
          </p>
        ) : (
          groups.map((g) => (
            <section key={g.season} aria-labelledby={`season-${g.season}`} className="mt-8">
              <h2 id={`season-${g.season}`} className="text-lg font-semibold tracking-tight text-ink">
                {g.season === "Undated" ? "Undated" : `${g.season} season`}
              </h2>
              <ul role="list" className="mt-3 space-y-3">
                {g.briefs.map((b) => {
                  const period = formatPeriod(b.periodStart, b.periodEnd);
                  return (
                    <li key={b.slug} className="rounded-card border border-line bg-surface/40 p-4 sm:p-5">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-cyan">{periodLabel(b.week, b.phase)}</p>
                      <h3 className="mt-1 text-base font-semibold leading-snug text-ink sm:text-lg">
                        <Link
                          href={`/brief/${b.slug}`}
                          className="hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                        >
                          {b.title}
                        </Link>
                      </h3>
                      <p className="mt-1 text-xs text-ink-subtle">
                        {b.publishedAt && (
                          <>
                            Published <time dateTime={b.publishedAt}>{formatEasternDate(b.publishedAt)}</time>.{" "}
                          </>
                        )}
                        {period && <>Covers {period}.</>}
                      </p>
                      {b.tlDr && <p className="mt-2 text-sm leading-relaxed text-ink-muted">{b.tlDr}</p>}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </PageBody>
    </main>
  );
}
