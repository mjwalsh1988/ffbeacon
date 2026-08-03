/**
 * Quick news feature at the top of the overview: the single latest published
 * article that mentions this player, shown as a headline with an optional
 * summary. Articles do not link out yet (no public reader route), so this is a
 * read-only teaser. Falls back to a friendly empty state. Server component.
 */

import { Newspaper } from "lucide-react";
import { formatEastern } from "@/lib/datetime";
import type { LatestArticle } from "@/lib/player-profile";

/** Alias of the loader's row shape so the two cannot drift apart. */
export type QuickNewsArticle = LatestArticle;

export function QuickNews({
  article,
  playerName,
}: {
  article: QuickNewsArticle | null;
  playerName: string;
}) {
  return (
    <section
      aria-labelledby="quick-news-title"
      className="relative overflow-hidden rounded-modal border border-line bg-surface/60 p-5"
      style={{ boxShadow: "0 0 80px -52px rgba(34, 211, 238, 0.5)" }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
        }}
      />
      <div className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card border border-brand-cyan/50 bg-base text-brand-cyan"
        >
          <Newspaper className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p
            id="quick-news-title"
            className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-cyan"
          >
            Latest headline
          </p>
          {article ? (
            <>
              <h2 className="mt-1 text-lg font-semibold leading-snug tracking-tight text-ink">
                {article.title}
              </h2>
              {article.tl_dr && (
                <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{article.tl_dr}</p>
              )}
              {article.published_at && (
                <p className="mt-2 text-xs text-ink-subtle">{formatEastern(article.published_at)}</p>
              )}
            </>
          ) : (
            <p className="mt-1 text-sm leading-relaxed text-ink-muted">
              No recent headlines for {playerName}. New coverage from The Beacon Brief will appear
              here.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
