/**
 * One-time: archive the per-post Beacon Brief articles and record where each
 * slug redirects.
 *
 * docs/beacon-brief/relays-and-briefs-plan.md, section 14.2. NEVER scheduled.
 * Dry run is the DEFAULT; nothing is written without --apply. Run AFTER
 * scripts/backfill-relays.ts has been applied and checked, and after the
 * homepage, the player profiles and RSS switched to Relays (phase 2), so no
 * surface is left pointing at an archived row.
 *
 * For every article with origin = 'beacon_brief' that is still published:
 *   - find its earliest ingestion (news_ingestions.article_id) and that
 *     ingestion's Relay;
 *   - write (article_slug, relay_slug) into legacy_article_redirects;
 *   - set the article's status to 'archived'.
 * An article whose ingestion has no Relay (the backfill dropped it at the
 * gates) is archived without a redirect and listed in the report: its URL will
 * 404 like any removed page. Nothing is deleted; deleteArticle and
 * scripts/remove-brief-articles.ts remain available.
 *
 *   npm run archive:legacy-articles
 *   npm run archive:legacy-articles -- --apply
 */

import { getServiceClient } from "./_supabase";

async function main() {
  const apply = process.argv.includes("--apply");
  const admin = getServiceClient();

  const articles: { id: string; slug: string; title: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("articles")
      .select("id, slug, title")
      .eq("origin", "beacon_brief")
      // Plan 14.2 archives every beacon_brief article, not only the published
      // ones. A draft or an in-review legacy row left behind is a row an admin
      // can still publish into the layout this build retired.
      .not("status", "eq", "archived")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    articles.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  console.log(`${articles.length} unarchived legacy article(s). ${apply ? "APPLY" : "Dry run"}.`);

  const redirects: { article_slug: string; relay_slug: string }[] = [];
  const withoutRelay: string[] = [];

  for (const article of articles) {
    const { data: ingestion } = await admin
      .from("news_ingestions")
      .select("id")
      .eq("article_id", article.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const { data: relay } = ingestion
      ? await admin.from("relays").select("slug, status").eq("ingestion_id", ingestion.id).maybeSingle()
      : { data: null };
    if (relay && relay.status !== "retracted") {
      redirects.push({ article_slug: article.slug, relay_slug: relay.slug });
    } else {
      withoutRelay.push(article.slug);
    }
  }

  console.log(`${redirects.length} redirect(s) to write; ${withoutRelay.length} article(s) with no Relay to point at.`);
  for (const slug of withoutRelay) console.log(`  no relay: ${slug}`);

  if (!apply) {
    console.log("\nDry run. Nothing was written. Re-run with --apply to archive.");
    return;
  }

  for (let i = 0; i < redirects.length; i += 200) {
    const { error } = await admin
      .from("legacy_article_redirects")
      .upsert(redirects.slice(i, i + 200), { onConflict: "article_slug" });
    if (error) throw new Error(`redirect upsert failed: ${error.message}`);
  }
  const ids = articles.map((a) => a.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await admin
      .from("articles")
      .update({ status: "archived", last_updated: new Date().toISOString() })
      .in("id", ids.slice(i, i + 200));
    if (error) throw new Error(`archive update failed: ${error.message}`);
  }
  console.log(`\nArchived ${ids.length} article(s); ${redirects.length} redirect(s) recorded.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
