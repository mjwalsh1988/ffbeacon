/**
 * Audit historical Beacon Brief merges for stories that were wrongly swallowed.
 *
 * READ ONLY. It writes nothing and changes nothing. It exists because the merge
 * guardrails added in migration 0169 only protect posts from that point forward,
 * and we had no idea how many earlier stories had already been absorbed into
 * somebody else's article. This tells you.
 *
 * WHY THIS CANNOT JUST RE-RUN THE NEW GATES
 *
 * The obvious audit would replay the shared-subject gate over history. It returns
 * nothing. Merged rows written before 0169 carry no ai_result at all (the old code
 * classified a post only if it was NOT going to be merged), so every historical
 * merge has an empty player set and passes any subject check vacuously. The same
 * gap makes relevance tier unavailable. The data needed to judge these rows was
 * never recorded, which is itself one of the things 0169 fixed.
 *
 * So this works from what history DOES have: the post text, and the players linked
 * to the article it was folded into.
 *
 *   different-subject  the article is about specific players and the post mentions
 *                      none of them, while carrying enough text to be judged. This
 *                      is the strong signal and the one worth reviewing first.
 *   unverifiable       same, but the post is a bare link or too short to judge, so
 *                      absence of a name proves nothing.
 *   outside-window     the article was older than the current lookback window when
 *                      the post arrived. WEAK on its own: genuine multi-day stories
 *                      (a court case, a holdout) legitimately run past it.
 *
 * Run:
 *   npm run audit:brief-merges              suspect merges only
 *   npm run audit:brief-merges -- --all     every merge, with its verdict
 *   npm run audit:brief-merges -- --json    machine-readable, for piping
 */

import { getServiceClient } from "./_supabase";
import { loadBeaconBriefSettings } from "../lib/beacon-brief/settings";

type Row = {
  id: string;
  created_at: string;
  text: string | null;
  external_url: string | null;
  article_id: string;
  article_title: string;
  article_created_at: string;
  /** Full names of the players linked to the article this was folded into. */
  article_player_names: string[];
};

/** Post text with URLs and handles stripped, for both matching and length. */
function readableText(text: string | null): string {
  return (text ?? "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/@\w+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Does the post name any of the people the article is about? */
function mentionsAnyName(text: string, names: string[]): boolean {
  const haystack = text.toLowerCase();
  return names.some((full) => {
    const parts = full.toLowerCase().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return false;
    // Surname is the reliable token: reporters write "Arnold", not always the
    // full name. Require a word boundary so "Polk" does not match "Polkinghorne".
    const surname = parts[parts.length - 1];
    if (surname.length < 3) return haystack.includes(full.toLowerCase());
    return new RegExp(`(?<![a-z])${surname}(?![a-z])`, "i").test(haystack);
  });
}

// Below this many characters of real prose, a post carries no name simply because
// it carries almost nothing ("More on this:" plus a link), and its silence about
// the article's subject is not evidence of anything.
const MIN_JUDGEABLE_CHARS = 40;

function verdictFor(row: Row, lookbackHours: number): string[] {
  const reasons: string[] = [];
  const prose = readableText(row.text);
  if (row.article_player_names.length > 0) {
    if (!mentionsAnyName(prose, row.article_player_names)) {
      reasons.push(
        prose.length >= MIN_JUDGEABLE_CHARS
          ? "different-subject"
          : "unverifiable",
      );
    }
  }
  const gapHours =
    (new Date(row.created_at).getTime() -
      new Date(row.article_created_at).getTime()) /
    3_600_000;
  if (gapHours > lookbackHours) reasons.push("outside-window");
  return reasons;
}

async function main() {
  const showAll = process.argv.includes("--all");
  const asJson = process.argv.includes("--json");
  const admin = getServiceClient();
  const settings = await loadBeaconBriefSettings(admin);

  // One pass: every merged post, the article it landed in, and both subject sets.
  // Paged because news_ingestions is well past the 1000-row default.
  const rows: Row[] = [];
  const PAGE = 500;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("news_ingestions")
      .select(
        "id, created_at, text, external_url, revision_of_ingestion_id, target:revision_of_ingestion_id(article_id, articles:article_id(id, title, created_at))",
      )
      .eq("is_revision", true)
      .not("revision_of_ingestion_id", "is", null)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;

    for (const r of data as unknown as Array<Record<string, never>>) {
      const target = (r as Record<string, unknown>).target as {
        article_id: string | null;
        articles: { id: string; title: string; created_at: string } | null;
      } | null;
      if (!target?.articles) continue;
      rows.push({
        id: (r as Record<string, unknown>).id as string,
        created_at: (r as Record<string, unknown>).created_at as string,
        text: (r as Record<string, unknown>).text as string | null,
        external_url: (r as Record<string, unknown>).external_url as
          | string
          | null,
        article_id: target.articles.id,
        article_title: target.articles.title,
        article_created_at: target.articles.created_at,
        article_player_names: [],
      });
    }
    if (data.length < PAGE) break;
  }

  // Who each target article is about, by name, so the post text can be checked
  // against it. Names rather than ids because the post text is all history gives
  // us to compare against.
  const articleIds = [...new Set(rows.map((r) => r.article_id))];
  const namesByArticle = new Map<string, string[]>();
  for (let i = 0; i < articleIds.length; i += 200) {
    const slice = articleIds.slice(i, i + 200);
    const { data } = await admin
      .from("article_players")
      .select("article_id, players:player_id(full_name)")
      .in("article_id", slice);
    for (const r of data ?? []) {
      const rec = r as unknown as {
        article_id: string;
        players: { full_name: string | null } | null;
      };
      const name = rec.players?.full_name;
      if (!name) continue;
      const list = namesByArticle.get(rec.article_id);
      if (list) list.push(name);
      else namesByArticle.set(rec.article_id, [name]);
    }
  }
  for (const row of rows) {
    row.article_player_names = namesByArticle.get(row.article_id) ?? [];
  }

  const judged = rows.map((r) => ({
    row: r,
    reasons: verdictFor(r, settings.followupLookbackHours),
  }));
  // Sort the strong signal to the top: that is the review worklist.
  const rank = (reasons: string[]) =>
    reasons.includes("different-subject")
      ? 0
      : reasons.includes("unverifiable")
        ? 1
        : 2;
  judged.sort((a, b) => rank(a.reasons) - rank(b.reasons));
  const suspect = judged.filter((j) => j.reasons.length > 0);

  if (asJson) {
    console.log(
      JSON.stringify(
        (showAll ? judged : suspect).map((j) => ({
          ingestion_id: j.row.id,
          url: j.row.external_url,
          post: (j.row.text ?? "").slice(0, 160),
          merged_into: j.row.article_title,
          article_id: j.row.article_id,
          reasons: j.reasons,
        })),
        null,
        2,
      ),
    );
    return;
  }

  console.log(
    `Merges examined: ${rows.length}   suspect: ${suspect.length}   lookback now ${settings.followupLookbackHours}h\n`,
  );
  for (const j of showAll ? judged : suspect) {
    const gapH = Math.round(
      (new Date(j.row.created_at).getTime() -
        new Date(j.row.article_created_at).getTime()) /
        3_600_000,
    );
    console.log(`[${j.reasons.join(", ") || "ok"}] +${gapH}h`);
    console.log(`  post:   ${(j.row.text ?? "").replace(/\s+/g, " ").slice(0, 120)}`);
    console.log(`  merged: ${j.row.article_title}`);
    console.log(`  ids:    ingestion=${j.row.id} article=${j.row.article_id}`);
    console.log("");
  }
  console.log(
    "Nothing was changed. To give one of these its own article, force it back\n" +
      "through the pipeline from the admin Filtered queue, or reset the row and\n" +
      "re-run curation for that source.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
