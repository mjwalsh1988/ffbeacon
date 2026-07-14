import type { Metadata } from "next";
import { serializeJsonLd } from "@/lib/json-ld";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Users, Shield } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SITE } from "@/lib/site";
import { formatEastern } from "@/lib/datetime";
import { loadArticle, loadRelatedArticles } from "@/lib/beacon-brief-feed";
import { ArticleMarkdown } from "@/components/beacon-brief/article-markdown";
import { ArticleCard, articleTypeLabel } from "@/components/beacon-brief/article-card";
import { BriefBreadcrumb } from "@/components/beacon-brief/brief-breadcrumb";
import { DiscordCtaSection } from "@/components/discord-cta-section";
import { isDiscordMember } from "@/lib/discord-membership";

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createClient();
  const article = await loadArticle(supabase, slug);
  if (!article) return { title: "Article not found" };

  const canonical = article.canonicalUrl?.trim() || `${SITE.url}/brief/${slug}`;
  const description =
    article.metaDescription?.trim() ||
    article.tlDr?.trim() ||
    `${article.title} - fantasy football news from The Beacon Brief.`;
  const ogImage = `${SITE.url}/api/og/brief/${slug}`;

  return {
    title: article.title,
    description,
    alternates: { canonical },
    openGraph: {
      title: article.title,
      description,
      url: canonical,
      siteName: SITE.name,
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
  const supabase = await createClient();
  const article = await loadArticle(supabase, slug);
  if (!article) notFound();

  const related = await loadRelatedArticles(supabase, article);
  // Confirmed Discord members already have the community; point the closing CTA
  // at the tools instead of the invite.
  const isMember = await isDiscordMember();
  const canonical = article.canonicalUrl?.trim() || `${SITE.url}/brief/${slug}`;
  const categoryLabel = article.category?.name ?? articleTypeLabel(article.articleType);
  const description =
    article.metaDescription?.trim() || article.tlDr?.trim() || article.title;

  // Show an "Updated" line only when the content genuinely changed after
  // publishing (allow a small clock skew between the two timestamps).
  const publishedMs = article.publishedAt ? new Date(article.publishedAt).getTime() : 0;
  const updatedMs = article.lastUpdated ? new Date(article.lastUpdated).getTime() : 0;
  const showUpdated = Boolean(article.lastUpdated) && updatedMs - publishedMs > 60_000;

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "NewsArticle",
      headline: article.title,
      description,
      ...(article.publishedAt ? { datePublished: article.publishedAt } : {}),
      ...(article.lastUpdated ? { dateModified: article.lastUpdated } : {}),
      author: { "@type": "Organization", name: SITE.name, url: SITE.url },
      publisher: {
        "@type": "Organization",
        name: SITE.name,
        logo: {
          "@type": "ImageObject",
          url: `${SITE.url}/img/ff-beacon-logo.png`,
        },
      },
      image: [`${SITE.url}/api/og/brief/${slug}`],
      mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
      ...(article.category ? { articleSection: article.category.name } : {}),
      ...(article.tags.length ? { keywords: article.tags.join(", ") } : {}),
      url: canonical,
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE.url },
        { "@type": "ListItem", position: 2, name: "The Beacon Brief", item: `${SITE.url}/brief` },
        { "@type": "ListItem", position: 3, name: article.title, item: canonical },
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
                <time dateTime={article.publishedAt} className="text-xs text-ink-subtle">
                  {formatEastern(article.publishedAt)}
                </time>
              )}
            </div>

            <h1 className="mt-4 text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl">
              {article.title}
            </h1>

            {showUpdated && article.lastUpdated && (
              <p className="mt-2 text-xs text-ink-subtle">
                Updated{" "}
                <time dateTime={article.lastUpdated}>{formatEastern(article.lastUpdated)}</time>
              </p>
            )}
          </header>

          {/* The gist */}
          {article.tlDr && (
            <aside
              aria-label="Summary"
              className="mt-6 rounded-card border border-line bg-surface/50 p-4 sm:p-5"
            >
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-cyan">
                The gist
              </p>
              <p className="text-sm leading-relaxed text-ink sm:text-base">{article.tlDr}</p>
            </aside>
          )}

          {/* In this story: players + teams */}
          {(article.players.length > 0 || article.teams.length > 0) && (
            <section aria-label="Players and teams in this story" className="mt-6 space-y-3">
              {article.players.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                    <Users aria-hidden="true" className="h-3.5 w-3.5 text-brand-cyan" />
                    Players
                  </span>
                  {article.players.map((p) => (
                    <Link
                      key={p.slug}
                      href={`/brief/player/${p.slug}`}
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
                    <Shield aria-hidden="true" className="h-3.5 w-3.5 text-brand-cyan" />
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
          <section aria-labelledby="related-heading" className="mt-12 border-t border-line pt-8">
            <h2 id="related-heading" className="mb-5 text-xl font-semibold tracking-tight text-ink">
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

      <DiscordCtaSection
        eyebrow="React to this story"
        heading="What does this mean for your team? Ask real people."
        body="Bring this story into our Discord and real fantasy managers will help you work out the fantasy impact for your specific roster, free. Curious what else FF Beacon is building? Read about the project."
        className="mt-4 border-t border-line"
        isMember={isMember}
        memberHeading="Read the story. Now act on it."
        memberBody="You're already in the crew, so we'll skip the invite. Take this news into the free FF Beacon tools and turn it into a real roster decision."
      />
    </main>
  );
}
