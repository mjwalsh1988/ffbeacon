import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { formatEasternDate } from "@/lib/datetime";
import type { FeedArticle } from "@/lib/beacon-brief-feed";

/** Turn an article_type slug ("roster-moves") into a display label
 * ("Roster Moves"). Used only when an article has no linked category. */
export function articleTypeLabel(type: string): string {
  return type
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Summary card for one article in the Beacon Brief feed. The whole card is a
 * single link to the article; the category chip is a decorative label (not a
 * nested link) so the card stays one tap target and keyboard stop.
 */
export function ArticleCard({ article }: { article: FeedArticle }) {
  const label = article.category?.name ?? articleTypeLabel(article.articleType);
  const dateIso = article.publishedAt ?? article.lastUpdated;

  return (
    <Link
      href={`/brief/${article.slug}`}
      className="group flex h-full flex-col rounded-card border border-line bg-surface-elevated p-5 shadow-lg shadow-black/20 transition-all duration-200 hover:-translate-y-1 hover:border-brand-purple/60 hover:shadow-xl hover:shadow-brand-purple/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center rounded-full border border-brand-cyan/40 bg-brand-cyan/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-cyan">
          {label}
        </span>
        {dateIso && (
          <span className="text-xs text-ink-subtle">{formatEasternDate(dateIso)}</span>
        )}
      </div>

      <h3 className="mt-3 text-lg font-semibold leading-snug tracking-tight text-ink group-hover:text-white">
        {article.title}
      </h3>

      {article.tlDr && (
        <p className="mt-2 line-clamp-3 flex-1 text-sm leading-relaxed text-ink-muted">
          {article.tlDr}
        </p>
      )}

      <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-cyan">
        Read article
        <ArrowRight
          aria-hidden="true"
          className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
        />
      </span>
    </Link>
  );
}
