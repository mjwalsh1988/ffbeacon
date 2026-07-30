import { cache } from "react";
import type { Metadata } from "next";
import { serializeJsonLd } from "@/lib/json-ld";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Users, Shield, Sparkles } from "lucide-react";
import { createCachedReadClient } from "@/lib/supabase/server";
import { SITE } from "@/lib/site";
import { formatEastern } from "@/lib/datetime";
import {
  loadArticle,
  loadRelatedArticles,
  publishedArticleSlugs,
} from "@/lib/beacon-brief-feed";
import { ArticleMarkdown } from "@/components/beacon-brief/article-markdown";
import {
  ArticleCard,
  articleTypeLabel,
} from "@/components/beacon-brief/article-card";
import { BriefBreadcrumb } from "@/components/beacon-brief/brief-breadcrumb";
import { DiscordCtaSection } from "@/components/discord-cta-section";

type PageProps = { params: Promise<{ slug: string }> };

/**
 * Articles are statically rendered and revalidated on a timer.
 *
 * Nothing on this page varies per visitor: the content is public, and the closing
 * Discord CTA now always renders its invite variant rather than checking the viewer's
 * membership. That check was the only per-request input, and it forced every article
 * view to render on demand. Prerendering instead serves articles from the edge cache,
 * which is the single biggest time-to-first-byte win available here and feeds directly
 * into Core Web Vitals.
 *
 * Five minutes is short enough that a revision published by the Beacon Brief worker
 * surfaces quickly, and long enough that a burst of traffic on a breaking story is
 * served almost entirely from cache.
 */
export const revalidate = 300;

/**
 * Prerender every published article at build time. Slugs published after the build
 * are not listed here, but `dynamicParams` defaults to true, so a new article renders
 * on first request and is cached from then on.
 */
export async function generateStaticParams() {
  const supabase = createCachedReadClient();
  const slugs = await publishedArticleSlugs(supabase);
  return slugs.map((slug) => ({ slug }));
}

/**
 * Request-scoped memo of the article load.
 *
 * Next.js calls generateMetadata and the page component separately for the same
 * request, and loadArticle runs three queries (article, players, teams). Without
 * this the render costs six. React cache() collapses them to one load per request,
 * which cuts time to first byte on every article view. Keyed on the slug only, so
 * both call sites share the entry (passing a per-call Supabase client would key
 * them apart and defeat the memo).
 */
const getArticle = cache(async (slug: string) => {
  const supabase = createCachedReadClient();
  return loadArticle(supabase, slug);
});

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = await getArticle(slug);
  if (!article) return { title: "Article not found" };

  const canonical = article.canonicalUrl?.trim() || `${SITE.url}/brief/${slug}`;
  const description =
    article.metaDescription?.trim() ||
    article.tlDr?.trim() ||
    `${article.title} - fantasy football news from The Beacon Brief.`;
  const ogImage = `${SITE.url}/api/og/brief/${slug}`;

  return {
    // `absolute` opts out of the root layout's "%s | FF Beacon" template. The
    // article prompt targets a 50-60 character headline, which is already at
    // Google's display limit; appending a 12-character brand suffix would push
    // every title into truncation. The brand is carried by openGraph.siteName
    // and the JSON-LD publisher instead.
    title: { absolute: article.title },
    description,
    alternates: {
      canonical,
      // Feed autodiscovery, same as the Brief index. An article page is the most
      // likely URL someone pastes into a reader.
      types: {
        "application/rss+xml": [
          { url: "/brief/rss.xml", title: "The Beacon Brief" },
        ],
      },
    },
    // Google needs max-image-preview:large to show a full-size thumbnail in
    // Discover and news surfaces, and -1 removes the snippet length cap.
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
    openGraph: {
      title: article.title,
      description,
      url: canonical,
      siteName: SITE.name,
      locale: "en_US",
      type: "article",
      publishedTime: article.publishedAt ?? undefined,
      modifiedTime: article.lastUpdated ?? undefined,
      authors: [SITE.author.name],
      section: article.category?.name,
      tags: article.tags,
      images: [{ url: ogImage, width: 1200, height: 630, alt: article.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: article.title,
      description,
      images: [ogImage],
    },
  };
}

export default async function BriefArticlePage({ params }: PageProps) {
  const { slug } = await params;
  const article = await getArticle(slug);
  if (!article) notFound();

  const supabase = createCachedReadClient();
  const related = await loadRelatedArticles(supabase, article);
  const canonical = article.canonicalUrl?.trim() || `${SITE.url}/brief/${slug}`;
  const categoryLabel =
    article.category?.name ?? articleTypeLabel(article.articleType);
  const description =
    article.metaDescription?.trim() || article.tlDr?.trim() || article.title;

  // Show an "Updated" line only when the content genuinely changed after
  // publishing (allow a small clock skew between the two timestamps).
  const publishedMs = article.publishedAt
    ? new Date(article.publishedAt).getTime()
    : 0;
  const updatedMs = article.lastUpdated
    ? new Date(article.lastUpdated).getTime()
    : 0;
  const showUpdated =
    Boolean(article.lastUpdated) && updatedMs - publishedMs > 60_000;

  // Google truncates headlines past 110 characters in news surfaces, so the
  // schema headline is bounded even if an article title runs long.
  const schemaHeadline =
    article.title.length > 110
      ? `${article.title.slice(0, 107).trimEnd()}...`
      : article.title;
  // Rough word count of the rendered prose: strip markdown markers first so
  // syntax is not counted as words.
  const wordCount = (article.contentMd ?? "")
    .replace(/[#*_`>[\]()!-]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  // Entities the story is about. Naming them explicitly helps Google connect the
  // article to the players and teams rather than inferring from prose alone.
  const about = [
    // Person url points at the player profile, the canonical page for that entity on
    // this site, matching where the visible player pills now link. Teams still point
    // at the Brief's team archive because there is no team profile page yet.
    ...article.players.map((p) => ({
      "@type": "Person",
      name: p.name,
      url: `${SITE.url}/players/${p.slug}`,
    })),
    ...article.teams.map((t) => ({
      "@type": "SportsTeam",
      name: t.name,
      url: `${SITE.url}/brief/team/${t.abbreviation}`,
    })),
  ];

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "NewsArticle",
      headline: schemaHeadline,
      description,
      inLanguage: "en-US",
      isAccessibleForFree: true,
      ...(article.publishedAt ? { datePublished: article.publishedAt } : {}),
      ...(article.lastUpdated ? { dateModified: article.lastUpdated } : {}),
      // A named Person author carries more weight than an Organization for news
      // eligibility, and it points at the real byline page.
      author: {
        "@type": "Person",
        name: SITE.author.name,
        url: `${SITE.url}${SITE.author.bylineHref}`,
      },
      publisher: {
        "@type": "Organization",
        name: SITE.name,
        url: SITE.url,
        logo: {
          "@type": "ImageObject",
          url: `${SITE.url}/img/ff-beacon-logo.png`,
        },
      },
      // ImageObject with explicit dimensions, rather than a bare URL, so Google
      // does not have to fetch the image to learn it qualifies as large.
      image: [
        {
          "@type": "ImageObject",
          url: `${SITE.url}/api/og/brief/${slug}`,
          width: 1200,
          height: 630,
        },
      ],
      mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
      ...(article.category ? { articleSection: article.category.name } : {}),
      ...(article.tags.length ? { keywords: article.tags.join(", ") } : {}),
      ...(wordCount > 0 ? { wordCount } : {}),
      ...(about.length ? { about } : {}),
      url: canonical,
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE.url },
        {
          "@type": "ListItem",
          position: 2,
          name: "The Beacon Brief",
          item: `${SITE.url}/brief`,
        },
        {
          "@type": "ListItem",
          position: 3,
          name: article.title,
          item: canonical,
        },
      ],
    },
  ];

  return (
    <main id="main">
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />

      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        {/* Breadcrumb: FF Beacon logo (Beacon Brief home), category, article. */}
        <BriefBreadcrumb
          crumbs={[
            { label: "The Beacon Brief", href: "/brief" },
            ...(article.category
              ? [
                  {
                    label: article.category.name,
                    href: `/brief/category/${article.category.slug}`,
                  },
                ]
              : []),
            { label: article.title },
          ]}
          className="mb-6"
        />

        <article>
          <header>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {article.category ? (
                <Link
                  href={`/brief/category/${article.category.slug}`}
                  className="inline-flex items-center rounded-full border border-brand-cyan/40 bg-brand-cyan/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-cyan hover:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  {article.category.name}
                </Link>
              ) : (
                <span className="inline-flex items-center rounded-full border border-brand-cyan/40 bg-brand-cyan/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-cyan">
                  {categoryLabel}
                </span>
              )}
              {article.publishedAt && (
                <time
                  dateTime={article.publishedAt}
                  className="text-xs text-ink-subtle"
                >
                  {formatEastern(article.publishedAt)}
                </time>
              )}
            </div>

            <h1 className="mt-4 text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl">
              {article.title}
            </h1>

            {/* Visible byline linking to the author page. The NewsArticle schema
                declares a Person author, and Google's news guidance expects that
                claim to be visible and attributable on the page itself, not only in
                structured data. rel="author" ties the link to the byline. */}
            <p className="mt-3 text-xs text-ink-subtle">
              By{" "}
              <Link
                rel="author"
                href={SITE.author.bylineHref}
                className="font-semibold text-ink-muted underline underline-offset-2 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
              >
                {SITE.author.name}
              </Link>
            </p>

            {showUpdated && article.lastUpdated && (
              <p className="mt-2 text-xs text-ink-subtle">
                Updated{" "}
                <time dateTime={article.lastUpdated}>
                  {formatEastern(article.lastUpdated)}
                </time>
              </p>
            )}
          </header>

          {/* The gist: the article summary.

              Colors here are INLINE STYLES on purpose, not Tailwind classes.

              The summary text was reported as unreadably dark twice. The utility
              classes are provably correct: `.text-ink` compiles to
              `color: rgb(244 244 248)` in the built CSS, body is #F4F4F8 on #07070D,
              globals.css declares color in exactly one place, there are no Tailwind
              plugins, and no rule anywhere in any CSS chunk targets this element. So
              whatever is darkening it is not in this stylesheet: a browser extension,
              a forced-colors or reader mode, or an injected style would all beat a
              single-class selector.

              An inline style beats every one of those (only `!important` outranks it),
              so the color is stated literally here and cannot be lost. Layout and
              spacing stay as classes; only the colors are pinned.

              #F4F4F8 on #16162A is about 15:1, comfortably past WCAG AAA. */}
          {article.tlDr && (
            <aside
              aria-label="Summary"
              className="mt-6 rounded-card p-px"
              style={{
                backgroundImage:
                  "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
              }}
            >
              <div
                className="rounded-[11px] p-4 sm:p-5"
                style={{ backgroundColor: "#16162A", color: "#F4F4F8" }}
              >
                <p
                  className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]"
                  style={{ color: "#22D3EE" }}
                >
                  <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
                  The gist
                </p>
                <p
                  className="text-sm font-medium leading-relaxed sm:text-base"
                  style={{ color: "#F4F4F8" }}
                >
                  {article.tlDr}
                </p>
              </div>
            </aside>
          )}

          {/* In this story: players + teams */}
          {(article.players.length > 0 || article.teams.length > 0) && (
            <section
              aria-label="Players and teams in this story"
              className="mt-6 space-y-3"
            >
              {/* Player pills point at the full player profile, NOT at
                  /brief/player/{slug}.

                  The Brief's per-player archive sets robots noindex, so every one of
                  these links used to hand Google a destination it had been told to
                  ignore, while /players/{slug} (values across every source and
                  format, trends, stats, projections, and its own Beacon Brief news
                  tab) received no internal links from the article library at all.
                  Internal links are how relevance moves around a site, and these
                  were pouring it into a dead end.

                  Nothing is lost for the reader: the profile carries that player's
                  news on its Beacon Brief tab, alongside the value data the archive
                  page never had. */}
              {article.players.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                    <Users
                      aria-hidden="true"
                      className="h-3.5 w-3.5 text-brand-cyan"
                    />
                    Players
                  </span>
                  {article.players.map((p) => (
                    <Link
                      key={p.slug}
                      href={`/players/${p.slug}`}
                      className="inline-flex items-center rounded-full border border-line bg-base px-2.5 py-1 text-xs text-ink-muted hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                    >
                      {p.name}
                    </Link>
                  ))}
                </div>
              )}
              {article.teams.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                    <Shield
                      aria-hidden="true"
                      className="h-3.5 w-3.5 text-brand-cyan"
                    />
                    Teams
                  </span>
                  {article.teams.map((t) => (
                    <Link
                      key={t.abbreviation}
                      href={`/brief/team/${t.abbreviation}`}
                      className="inline-flex items-center rounded-full border border-line bg-base px-2.5 py-1 text-xs text-ink-muted hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                    >
                      {t.name}
                    </Link>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Body */}
          <div className="mt-8 border-t border-line pt-6">
            {article.contentMd ? (
              <ArticleMarkdown content={article.contentMd} />
            ) : (
              <p className="text-ink-muted">{article.tlDr}</p>
            )}
          </div>

          {/* Tags */}
          {article.tags.length > 0 && (
            <div className="mt-8 border-t border-line pt-6">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-ink-subtle">
                Tags
              </h2>
              <ul className="flex flex-wrap gap-2">
                {article.tags.map((tag) => (
                  <li key={tag}>
                    <Link
                      href={`/brief/tag/${encodeURIComponent(tag)}`}
                      className="inline-flex items-center rounded-full border border-line bg-base px-2.5 py-1 text-xs text-ink-muted hover:border-line-accent hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                    >
                      {tag}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </article>

        {/* Related */}
        {related.length > 0 && (
          <section
            aria-labelledby="related-heading"
            className="mt-12 border-t border-line pt-8"
          >
            <h2
              id="related-heading"
              className="mb-5 text-xl font-semibold tracking-tight text-ink"
            >
              More from {categoryLabel}
            </h2>
            <ul role="list" className="grid gap-5 sm:grid-cols-2">
              {related.map((a) => (
                <li key={a.slug}>
                  <ArticleCard article={a} />
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="mt-12">
          <Link
            href="/brief"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-card border border-line bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            All Beacon Brief articles
          </Link>
        </div>
      </div>

      {/* No isMember prop on purpose. Checking Discord membership reads the request,
          which would make this page dynamic and lose the static render. The invite
          variant is the correct default for a page that is mostly reached from search
          by people who are not in the community yet. Member-aware CTAs still work on
          the dynamic pages. */}
      <DiscordCtaSection
        eyebrow="React to this story"
        heading="What does this mean for your team? Ask real people."
        body="Bring this story into our Discord and real fantasy managers will help you work out the fantasy impact for your specific roster, free. Curious what else FF Beacon is building? Read about the project."
        className="mt-4 border-t border-line"
      />
    </main>
  );
}
