/**
 * Backtest the Beacon Brief relevance classifier against every post we have
 * already ingested.
 *
 * WHY THIS EXISTS
 * The relevance gate decides, before any money is spent, whether a post reaches
 * Discord and the article writer. Tuning that gate on live traffic means finding
 * out about a false positive only after a real story was silently dropped. Every
 * ingestion row keeps the full source post, so the whole decision can be replayed
 * offline instead: score the archive, then compare each score against what the
 * pipeline actually did with that post.
 *
 * It never writes to a production table. Output is a CSV plus a console summary.
 *
 * Run:
 *   npm run backtest:brief-relevance
 *   npm run backtest:brief-relevance -- --prompt-file ./candidate.txt --threshold 2
 *   npm run backtest:brief-relevance -- --limit 25          (cheap smoke run)
 *
 * Flags:
 *   --prompt-file <path>  Score with a candidate prompt instead of the live
 *                         bb_categorize_prompt row. This is the point of the
 *                         script: try a rewrite before committing it.
 *   --threshold <n>       Relevance cutoff to report against. Default 2.
 *   --limit <n>           Score only the n most recent posts.
 *   --out <path>          CSV destination. Default ./backtest-relevance.csv
 *
 * Revisions are skipped. They bypass both existing filter gates by design (a
 * revision patches a story we already accepted), so scoring them would measure
 * nothing the gate acts on.
 */

import { readFileSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { getServiceClient } from "./_supabase";

/** Mirrors CATEGORIZE_SCHEMA in lib/beacon-brief/curate.ts. */
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "non_football",
    "relevance_tier",
    "relevance_reason",
    "context_score",
    "category_slug",
    "players",
    "teams",
    "tags",
    "suggested_title",
    "suggested_slug",
  ],
  properties: {
    non_football: { type: "integer" },
    relevance_tier: { type: "integer" },
    relevance_reason: { type: "string" },
    context_score: { type: "integer" },
    category_slug: { type: "string" },
    players: { type: "array", items: { type: "string" } },
    teams: { type: "array", items: { type: "string" } },
    tags: { type: "array", items: { type: "string" } },
    suggested_title: { type: "string" },
    suggested_slug: { type: "string" },
  },
} as const;

interface Scored {
  id: string;
  status: string;
  filterReason: string | null;
  articleTitle: string | null;
  text: string;
  nonFootball: number | null;
  tier: number | null;
  reason: string;
  failed: boolean;
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

/** Minimal RFC 4180 field escaping. */
function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return `"${s.replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
}

/** Same compact model-facing shape the live pipeline sends. */
function compact(row: {
  text: string | null;
  author_handle: string | null;
  media: unknown;
  quoted: unknown;
  retweeted: unknown;
}) {
  const embedded = (raw: unknown) => {
    const q = raw as { text?: unknown; author_handle?: unknown } | null;
    return q && typeof q.text === "string"
      ? {
          text: q.text,
          author_handle:
            typeof q.author_handle === "string" ? q.author_handle : null,
        }
      : null;
  };
  return {
    text: row.text ?? "",
    author_handle: row.author_handle ?? "",
    media: Array.isArray(row.media)
      ? (row.media as Array<{ type?: unknown }>).map((m) =>
          m && typeof m.type === "string" ? m.type : "media",
        )
      : [],
    quoted: embedded(row.quoted),
    retweeted: embedded(row.retweeted),
  };
}

/** Run n workers over the queue so a few hundred posts finish in a minute. */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      for (;;) {
        const i = next;
        next += 1;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    },
  );
  await Promise.all(workers);
  return out;
}

async function main() {
  const threshold = Number(arg("threshold") ?? 2);
  const limit = arg("limit") ? Number(arg("limit")) : null;
  const outPath = arg("out") ?? "./backtest-relevance.csv";
  const promptFile = arg("prompt-file");

  const supabase = getServiceClient();

  const { data: settingRows } = await supabase
    .from("beacon_settings")
    .select("key, value")
    .eq("category", "beacon_brief");
  const settings = new Map<string, unknown>(
    (settingRows ?? []).map((r) => [r.key, r.value]),
  );
  const model =
    typeof settings.get("bb_model_triage") === "string"
      ? (settings.get("bb_model_triage") as string)
      : "claude-haiku-4-5";

  let prompt: string;
  if (promptFile) {
    prompt = readFileSync(promptFile, "utf8");
    console.log(`Prompt: candidate from ${promptFile}`);
  } else {
    const live = settings.get("bb_categorize_prompt");
    if (typeof live !== "string" || !live) {
      throw new Error("bb_categorize_prompt is missing; pass --prompt-file");
    }
    prompt = live;
    console.log("Prompt: live bb_categorize_prompt");
  }

  const { data: categories } = await supabase
    .from("news_categories")
    .select("slug")
    .eq("is_active", true)
    .order("display_order");
  const system = prompt.replace(
    "{categories}",
    (categories ?? []).map((c) => c.slug).join(", "),
  );

  let q = supabase
    .from("news_ingestions")
    .select(
      "id, status, filter_reason, text, author_handle, media, quoted, retweeted, article_id",
    )
    .eq("is_revision", false)
    .order("created_at", { ascending: false });
  if (limit) q = q.limit(limit);
  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);
  if (!rows || rows.length === 0) {
    console.log("No ingestions to score.");
    return;
  }

  // Article titles make the CSV readable; a bare ingestion id does not tell you
  // which story a row is.
  const articleIds = rows
    .map((r) => r.article_id)
    .filter((id): id is string => Boolean(id));
  const titleById = new Map<string, string>();
  if (articleIds.length > 0) {
    const { data: articles } = await supabase
      .from("articles")
      .select("id, title")
      .in("id", articleIds);
    for (const a of articles ?? []) titleById.set(a.id, a.title ?? "");
  }

  console.log(
    `Scoring ${rows.length} posts with ${model}, threshold ${threshold}\n`,
  );
  const client = new Anthropic();

  let done = 0;
  const scored = await mapWithConcurrency(
    rows,
    5,
    async (row): Promise<Scored> => {
      const base = {
        id: row.id,
        status: row.status ?? "",
        filterReason: row.filter_reason,
        articleTitle: row.article_id
          ? (titleById.get(row.article_id) ?? null)
          : null,
        text: (row.text ?? "").slice(0, 160),
      };
      try {
        const res = await client.messages.create({
          model,
          max_tokens: 1024,
          system,
          messages: [{ role: "user", content: JSON.stringify(compact(row)) }],
          output_config: { format: { type: "json_schema", schema: SCHEMA } },
        });
        const text = res.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("")
          .trim();
        const parsed = JSON.parse(text) as {
          non_football?: number;
          relevance_tier?: number;
          relevance_reason?: string;
        };
        return {
          ...base,
          nonFootball: parsed.non_football ?? null,
          tier: parsed.relevance_tier ?? null,
          reason: parsed.relevance_reason ?? "",
          failed: false,
        };
      } catch (err) {
        return {
          ...base,
          nonFootball: null,
          tier: null,
          reason: err instanceof Error ? err.message : "call failed",
          failed: true,
        };
      } finally {
        done += 1;
        if (done % 25 === 0) console.log(`  ${done}/${rows.length}`);
      }
    },
  );

  const wouldFilter = (s: Scored) =>
    s.nonFootball === 1 || (s.tier !== null && s.tier < threshold);

  const header = [
    "ingestion_id",
    "actual_status",
    "actual_filter_reason",
    "article_title",
    "non_football",
    "relevance_tier",
    "relevance_reason",
    "would_filter",
    "verdict",
    "post_text",
  ];
  const lines = [header.map(csvCell).join(",")];

  // The two numbers that decide whether the gate ships:
  //   newly_blocked  posts that published and would now be filtered (the goal)
  //   would_publish  posts we already filtered that would now get through
  // Anything in newly_blocked that you wanted is a false positive.
  const newlyBlocked: Scored[] = [];
  const wouldPublish: Scored[] = [];
  const failures: Scored[] = [];

  for (const s of scored) {
    let verdict = "unchanged";
    if (s.failed) {
      verdict = "call failed";
      failures.push(s);
    } else if (s.status === "published" && wouldFilter(s)) {
      verdict = "newly blocked";
      newlyBlocked.push(s);
    } else if (s.status === "filtered" && !wouldFilter(s)) {
      verdict = "would now publish";
      wouldPublish.push(s);
    }
    lines.push(
      [
        s.id,
        s.status,
        s.filterReason ?? "",
        s.articleTitle ?? "",
        s.nonFootball,
        s.tier,
        s.reason,
        s.failed ? "" : wouldFilter(s) ? "yes" : "no",
        verdict,
        s.text,
      ]
        .map(csvCell)
        .join(","),
    );
  }

  writeFileSync(outPath, lines.join("\n"), "utf8");

  const tierCounts = new Map<string, number>();
  for (const s of scored) {
    const key = s.tier === null ? "failed" : String(s.tier);
    tierCounts.set(key, (tierCounts.get(key) ?? 0) + 1);
  }

  console.log(`\nScored ${scored.length} posts. CSV written to ${outPath}\n`);
  console.log("Tier distribution:");
  for (const key of ["3", "2", "1", "0", "failed"]) {
    if (tierCounts.has(key))
      console.log(`  tier ${key}: ${tierCounts.get(key)}`);
  }

  console.log(
    `\nPublished articles that would now be blocked: ${newlyBlocked.length}`,
  );
  for (const s of newlyBlocked) {
    console.log(
      `  [tier ${s.tier}] ${s.articleTitle ?? s.text} :: ${s.reason}`,
    );
  }

  console.log(
    `\nFiltered posts that would now get through: ${wouldPublish.length}`,
  );
  for (const s of wouldPublish) {
    console.log(`  [tier ${s.tier}] ${s.text} :: ${s.reason}`);
  }

  if (failures.length > 0) {
    console.log(`\nCalls that failed: ${failures.length}`);
    for (const s of failures.slice(0, 5)) console.log(`  ${s.id}: ${s.reason}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
