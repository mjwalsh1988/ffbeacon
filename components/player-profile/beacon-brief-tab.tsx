/**
 * Beacon Brief tab: published articles from The Beacon Brief that mention this
 * player. Titles link into the public reader at /brief/[slug]. Async server
 * component; reads through the anon server client, whose RLS already limits
 * articles to status = 'published'.
 */

import Link from "next/link";
import { Newspaper } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageBody } from "@/components/app-shell/page-body";
import { Panel } from "@/components/dashboard-panel";
import { formatEastern } from "@/lib/datetime";
import type { PlayerRow } from "@/lib/player-profile";

type BriefArticle = {
  slug: string;
  title: string;
  tl_dr: string | null;
  published_at: string | null;
  tags: string[] | null;
};

export async function BeaconBriefTab({
  player,
  playerName,
}: {
  player: PlayerRow;
  playerName: string;
}) {
  const supabase = await createClient();

  // Two-step: collect linked article ids, then load the published ones. Keeps
  // us off any embedded-order footguns and skips the second query when empty.
  const { data: links } = await supabase
    .from("article_players")
    .select("article_id")
    .eq("player_id", player.id);

  const articleIds = Array.from(new Set((links ?? []).map((l) => l.article_id).filter(Boolean)));

  let articles: BriefArticle[] = [];
  if (articleIds.length > 0) {
    const { data } = await supabase
      .from("articles")
      .select("slug, title, tl_dr, published_at, tags")
      .in("id", articleIds)
      .eq("status", "published")
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(30);
    articles = (data ?? []) as BriefArticle[];
  }

  return (
    <PageBody>
      <Panel
        eyebrow="News"
        title="The Beacon Brief"
        helper={`Coverage that mentions ${playerName}`}
      >
      {articles.length > 0 ? (
        <ul className="space-y-3">
          {articles.map((article) => (
            <li
              key={article.slug}
              className="rounded-card border border-line bg-surface/60 p-4"
            >
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card border border-brand-cyan/50 bg-base text-brand-cyan"
                >
                  <Newspaper className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-base font-semibold leading-snug text-ink">
                    <Link
                      href={`/brief/${article.slug}`}
                      className="transition-colors hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                    >
                      {article.title}
                    </Link>
                  </h3>
                  {article.tl_dr && (
                    <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{article.tl_dr}</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    {article.published_at && (
                      <p className="text-xs text-ink-subtle">{formatEastern(article.published_at)}</p>
                    )}
                    {article.tags && article.tags.length > 0 && (
                      <ul className="flex flex-wrap gap-1.5">
                        {article.tags.map((tag) => (
                          <li
                            key={tag}
                            className="rounded-full border border-line bg-base px-2 py-0.5 text-[11px] text-ink-muted"
                          >
                            {tag}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex items-start gap-3 rounded-card border border-dashed border-line bg-base/40 p-6">
          <span
            aria-hidden="true"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line bg-surface text-brand-cyan"
          >
            <Newspaper className="h-5 w-5" />
          </span>
          <div>
            <p className="text-base font-semibold text-ink">No coverage yet</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-muted">
              No Beacon Brief coverage for {playerName} yet. Player news will appear here as it
              publishes.
            </p>
          </div>
        </div>
      )}
      </Panel>
    </PageBody>
  );
}
