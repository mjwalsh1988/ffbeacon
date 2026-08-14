/**
 * End-to-end smoke test for BEAM against the real database.
 *
 * Run: npm run beam:smoke
 *
 * The context is built by hand rather than through lib/beam/context.ts, because
 * that path reads cookies() from next/headers to resolve the reader's format and
 * there are no cookies in a script. Everything with real logic in it (the
 * interpreter, the resolver, the capabilities, the presenters) runs exactly as it
 * does in production.
 *
 * This is a smoke test, not a unit test: it asks real questions and prints what
 * came back, so a human can read the sentences and judge whether they sound like
 * a person wrote them. The assertions in lib/beam/*.test.ts cover correctness.
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";
import { ask } from "../lib/beam/engine";
import { resolveBeamClock } from "../lib/beam/clock";
import { loadBeamSettings } from "../lib/beam/settings";
import type { BeamContext } from "../lib/beam/types";

const QUESTIONS = [
  // The five phrasings from the plan that must all reach one intent.
  "brock purdy passing yards 2025",
  "how many yards did purdy throw for",
  "how many pass yards did brock purdy have last year",
  "purdy passing yds",
  "what were brock purdys passing yards",
  // Typos and partials.
  "how many yards did brock prudy throw for in 2025",
  "how many touchdowns did jamyr gibs score last year",
  "cmc rushing yards 2024",
  "ceedee lamb targets",
  // Initials and apostrophes: these must hit the EXACT tier, not fuzzy.
  "how many receiving yards did A.J. Brown have in 2024",
  "ja'marr chase receiving touchdowns 2024",
  "amon-ra st. brown targets 2024",
  // Ambiguity that should ask, not guess.
  "how many yards did brock throw for",
  "how many yards did gibbs have in 2025",
  // Other capabilities.
  "who is better for dynasty garrett wilson or drake london",
  "who had more receiving yards in 2025 ceedee lamb or garrett wilson",
  "what is bijan robinson worth",
  "where does puka nacua rank",
  "how old is brock purdy",
  "how did jahmyr gibbs do in 2025",
  "what is faab",
  // Team defenses: the team vocabulary claims the nickname before name spans
  // are built, so these only work if the team becomes the subject.
  "how many sacks did the ravens have in 2024",
  "how many interceptions did the steelers have in 2024",
  "how many points did the broncos allow in 2024",
  // Direction: the leader must be the team that allowed FEWER.
  "who allowed fewer points in 2024 the broncos or the ravens",
  // Three players is a different question, not a weaker comparison.
  "who is better bijan robinson or jahmyr gibbs or breece hall",
  // A stat we hold nothing for must not read as a measured zero.
  "how many air yards did brock purdy have in 2025",
  // Week ranges, and a stretch projected across a season.
  "how many passing yards did brock purdy have last year between weeks 2 and 8",
  "how many receiving yards did marvin harrison and michael wilson each have between weeks 2 and 9 of last year",
  "project the season total from weeks 2 through week 4 from last year for michael wilson",
  "what pace was puka nacua on from weeks 1 to 6 in 2025",
  // A week range must not be read as a projection, and week 15 must not be
  // read as the 2015 season.
  "how many points did puka nacua score between weeks 15 and 17 last year",
  // Words nothing claims used to become extra "players" and trip the
  // too-many-players rule. Both of these carry three candidate name spans.
  "project tucker krafts season totals for last year by using his weeks 1 through 5",
  "how many receiving yards did marvin harrison and michael wilson have between weks 10 and 17 of last year",
  // Projections and projection accuracy.
  "who has the better projection beat rate over the last 3 years between james cook and josh jacobs",
  "what is james cooks beat rate",
  "what is bijan robinson projected for",
  "who is projected higher bijan robinson or jahmyr gibbs",
  // The menu question, and the draft guide's board.
  "what type of questions can i ask",
  "what can you do",
  "who are the draft steals",
  "which players should i avoid in my draft",
  "draft steals at running back",
  "late round swings",
  // A named player next to a board word is a question about him, not the board.
  "is bijan robinson a steal",
  // Dead ends.
  "who should i start this week in my league",
  "what is the weather in dallas",
  "how many yards did zzzz throw for",
];

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required.",
    );
  }

  const admin = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [clock, settings] = await Promise.all([
    resolveBeamClock(admin),
    loadBeamSettings(admin),
  ]);

  const { data: format } = await admin
    .from("format_configs")
    .select("id, slug, display_name, scoring_type, league_type, is_superflex")
    .eq("slug", "dynasty-ppr-sflex")
    .maybeSingle();

  const { data: source } = await admin
    .from("source_registry")
    .select("slug, display_name")
    .eq("is_default", true)
    .maybeSingle();

  const ctx: BeamContext = {
    supabase: admin,
    admin,
    formatSlug: format?.slug ?? "dynasty-ppr-sflex",
    formatConfigId: format?.id ?? null,
    formatDisplay: format?.display_name ?? "Dynasty PPR SF",
    scoringKey: "pts_ppr",
    isDynasty: true,
    isSuperflex: true,
    sourceSlug: source?.slug ?? "ffbeacon",
    sourceDisplay: source?.display_name ?? "FF Beacon",
    clock,
    settings,
  };

  console.log("Clock:", JSON.stringify(clock));
  console.log("Format:", ctx.formatDisplay, "| Source:", ctx.sourceDisplay);
  console.log("");

  for (const question of QUESTIONS) {
    const started = Date.now();
    const { outcome, trace } = await ask(question, ctx, { skipLogging: true });
    const ms = Date.now() - started;

    console.log("-".repeat(78));
    console.log(`Q: ${question}`);
    console.log(
      `   [${ms}ms] top reading: ${trace[0]?.capability ?? "none"} (${trace[0]?.score.toFixed(2) ?? "-"})`,
    );

    if (outcome.kind === "answer") {
      console.log(`   ANSWER: ${outcome.answer.headline}`);
      if (outcome.matchedPlayers.length > 0) {
        console.log(
          `   matched: ${outcome.matchedPlayers
            .map(
              (p) =>
                `${p.name} (${p.tier} ${p.confidence.toFixed(2)} from "${p.matchedOn}")`,
            )
            .join("; ")}`,
        );
      }
      for (const fact of outcome.answer.facts.slice(0, 4)) {
        console.log(`   - ${fact.label}: ${fact.value}`);
      }
      for (const caveat of outcome.answer.caveats)
        console.log(`   ! ${caveat}`);
    } else if (outcome.kind === "clarify") {
      console.log(`   CLARIFY: ${outcome.clarification.prompt}`);
      for (const option of outcome.clarification.options) {
        console.log(
          `   - ${option.label}${option.detail ? ` (${option.detail})` : ""}`,
        );
      }
    } else {
      console.log(`   UNSUPPORTED (${outcome.reason}): ${outcome.message}`);
    }
  }
  console.log("-".repeat(78));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
