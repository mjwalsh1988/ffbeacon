/**
 * Remove Beacon Brief articles by slug.
 *
 * Same effect as the per-article delete on the admin Articles page
 * (deleteArticle in app/admin/beacon-brief/actions.ts), for a batch. That action
 * cannot be called from a script because it runs requireAdmin against a request
 * session, so the database half is reproduced here and kept deliberately
 * identical to it:
 *
 *   1. Delete queue jobs pointing at the article's source ingestions.
 *   2. Delete moderation rows for those ingestions.
 *   3. Delete the article. article_players, article_teams, and article_revisions
 *      cascade with the row.
 *   4. Mark each source ingestion status = 'deleted'. The row is KEPT on purpose:
 *      it is the dedup guard that stops the same source post being re-ingested
 *      into a fresh article on the next poll.
 *
 * Discord is left alone. The admin action can also delete the linked Discord
 * message; this script never touches Discord, so discord_message_id and
 * discord_webhook_id stay set. Keeping discord_webhook_id set matters: it is the
 * sentinel that stops handleDiscordPost from ever reposting the card.
 *
 * Dry run is the DEFAULT. Nothing is written without --apply.
 *
 * Run:
 *   npm run remove:brief-articles -- --file slugs.txt
 *   npm run remove:brief-articles -- --file slugs.txt --apply
 *
 * The file is one slug per line. Only lines that are slug-shaped (lowercase
 * letters, digits, and hyphens, no spaces) are read, so a plain markdown document
 * with headings and explanatory prose can be passed directly and doubles as the
 * record of what was removed and why. Anything that is not slug-shaped is ignored
 * silently rather than reported as a miss.
 *
 * SEO NOTE: a deleted slug 404s afterwards. Before deleting an article, check
 * next.config.ts for a redirect whose DESTINATION is that slug. Leaving one in
 * place would point a permanent redirect at a 404.
 */

import { readFileSync } from "node:fs";
import { getServiceClient } from "./_supabase";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

/** A bare slug on its own line. Prose, headings, and blank lines fall through. */
const SLUG_LINE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function parseSlugFile(path: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!SLUG_LINE.test(line)) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
}

async function main() {
  const file = arg("file");
  const apply = process.argv.includes("--apply");
  if (!file) throw new Error("Pass --file <path to slug list>");

  const slugs = parseSlugFile(file);
  if (slugs.length === 0) throw new Error(`No slugs found in ${file}`);

  const supabase = getServiceClient();

  const { data: articles, error } = await supabase
    .from("articles")
    .select("id, slug, title, status")
    .in("slug", slugs);
  if (error) throw new Error(error.message);

  const found = new Map((articles ?? []).map((a) => [a.slug, a]));
  const missing = slugs.filter((s) => !found.has(s));

  console.log(
    `${slugs.length} slug(s) requested, ${found.size} matched in the database.`,
  );
  if (missing.length > 0) {
    // Not fatal: a slug can legitimately be gone already from an earlier run.
    console.log(`\nNot found (skipped):`);
    for (const s of missing) console.log(`  ${s}`);
  }
  if (found.size === 0) return;

  const ids = [...found.values()].map((a) => a.id);
  const { data: ingestions } = await supabase
    .from("news_ingestions")
    .select("id, article_id, discord_message_id")
    .in("article_id", ids);
  const ingestionIds = (ingestions ?? []).map((i) => i.id);
  const withCards = (ingestions ?? []).filter(
    (i) => i.discord_message_id,
  ).length;

  console.log(`\n${apply ? "DELETING" : "Would delete"}:`);
  for (const a of found.values()) {
    console.log(`  [${a.status}] ${a.slug}`);
    console.log(`      ${a.title}`);
  }
  console.log(
    `\n${ingestionIds.length} source ingestion(s) will be kept and marked 'deleted' (dedup guard).`,
  );
  console.log(
    `${withCards} of them have a Discord card, which this script leaves in place.`,
  );

  if (!apply) {
    console.log(
      `\nDry run. Nothing was written. Re-run with --apply to delete.`,
    );
    return;
  }

  // Order matters: clear everything that points at the ingestions first, then the
  // articles. A queue job or moderation row left behind would reference an
  // article id that no longer resolves.
  for (const id of ingestionIds) {
    const { error: qErr } = await supabase
      .from("beacon_brief_queue")
      .delete()
      .filter("payload->>ingestion_id", "eq", id);
    if (qErr)
      throw new Error(`queue cleanup failed for ${id}: ${qErr.message}`);
  }
  if (ingestionIds.length > 0) {
    const { error: mErr } = await supabase
      .from("beacon_brief_moderation")
      .delete()
      .in("ingestion_id", ingestionIds);
    if (mErr) throw new Error(`moderation cleanup failed: ${mErr.message}`);
  }

  const { error: delErr } = await supabase
    .from("articles")
    .delete()
    .in("id", ids);
  if (delErr) throw new Error(`article delete failed: ${delErr.message}`);

  if (ingestionIds.length > 0) {
    const { error: uErr } = await supabase
      .from("news_ingestions")
      .update({ status: "deleted", article_id: null })
      .in("id", ingestionIds);
    if (uErr) throw new Error(`ingestion update failed: ${uErr.message}`);
  }

  console.log(`\nDeleted ${ids.length} article(s).`);

  const { data: remaining } = await supabase
    .from("articles")
    .select("slug")
    .in("slug", slugs);
  console.log(
    remaining && remaining.length > 0
      ? `WARNING: ${remaining.length} still present: ${remaining.map((r) => r.slug).join(", ")}`
      : "Verified: none of the requested slugs remain.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
