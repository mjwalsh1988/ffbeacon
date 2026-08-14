/**
 * "What is FAAB?" / "What does TEP mean?"
 *
 * Answered from guide_entries, the Signal Guide's own glossary. Seventy-nine
 * published terms are already written, already reviewed, and already the
 * definition the rest of the site shows in its help panel. Writing a second
 * glossary for BEAM would guarantee the two drift, and the one a reader hits
 * would depend on which surface they were standing on.
 *
 * Global entries are preferred over page-scoped ones with the same heading,
 * because a global entry was written to stand alone.
 */

import { z } from "zod";
import type { BeamAnswer, BeamCapability } from "@/lib/beam/types";
import { buildContext, buildSpeech } from "@/lib/beam/answers/templates";
import { parseWith } from "./shared";

const schema = z.object({
  /** The term as the reader typed it, already normalized. */
  term: z.string().min(2).max(80),
});

type Params = z.infer<typeof schema>;

type Result = {
  heading: string;
  body: string;
};

export const glossaryTerm: BeamCapability<Params, Result> = {
  id: "glossary.term",
  label: "Fantasy term",
  description: "Plain-language definition of a fantasy football term.",
  playerScope: "historical",
  // Returning null here is how a stray phrase like "the weather in dallas"
  // stops being treated as a term. It becomes a dead end with the feedback
  // button, not an answer whose content is an apology.
  declineMessage: "We have not written a definition for that yet.",
  matcher: {
    base: 0.35,
    required: ["term"],
    optional: [],
    heads: ["what is", "what does"],
    playerCount: 0,
  },
  examples: ["What is FAAB?", "What does TEP mean?", "What is a superflex league?"],

  parse: (raw) => parseWith(schema, raw),

  async run(params, ctx): Promise<Result | null> {
    // ilike with the wildcards supplied here, never inside the term: `term` is
    // already normalized to letters, digits, and spaces, and % / _ are escaped
    // so a stray one cannot widen the match.
    const escaped = params.term.replace(/[%_]/g, (m) => `\\${m}`);

    const { data, error } = await ctx.supabase
      .from("guide_entries")
      .select("heading, body, is_global")
      .eq("kind", "term")
      .eq("is_published", true)
      .ilike("heading", `%${escaped}%`)
      .limit(10);

    if (error) return null;

    let rows = (data ?? []) as Array<{ heading: string; body: string; is_global: boolean }>;

    // Nothing in a heading. Try the bodies, because a glossary entry routinely
    // defines an abbreviation without putting it in its own title: TEP is
    // written up under the heading "TE Premium", and a heading-only search
    // reported that we had never defined it. The whole-word check is done here
    // rather than in SQL, because ilike '%tep%' also matches "step".
    if (rows.length === 0) {
      const { data: bodyData } = await ctx.supabase
        .from("guide_entries")
        .select("heading, body, is_global")
        .eq("kind", "term")
        .eq("is_published", true)
        .ilike("body", `%${escaped}%`)
        .limit(10);
      const wholeWord = new RegExp(`\\b${escapeRegExp(params.term)}\\b`, "i");
      rows = ((bodyData ?? []) as typeof rows).filter((row) => wholeWord.test(row.body));
    }

    if (rows.length === 0) return null;

    const target = params.term.toLowerCase();

    // Exact heading beats a substring hit, and a global entry beats a
    // page-scoped one. Otherwise the shortest heading wins, because a shorter
    // heading containing the term is more likely to BE the term.
    const scored = rows
      .map((row) => {
        const heading = row.heading.toLowerCase();
        let score = 0;
        if (heading === target) score += 100;
        else if (heading.startsWith(target)) score += 50;
        if (row.is_global) score += 10;
        score -= heading.length / 100;
        return { row, score };
      })
      .sort((a, b) => b.score - a.score);

    return { heading: scored[0].row.heading, body: scored[0].row.body };
  },

  present(result): BeamAnswer {
    const headline = result.heading;
    // The definition goes in `body`, not in a fact. A fact is a label and a
    // value laid out in two columns; a definition is two or three sentences,
    // and in that layout it wrapped into a column about twenty characters wide.
    const context = buildContext({ note: "From the FF Beacon Signal Guide glossary." });

    return {
      headline,
      body: result.body,
      // The definition IS the answer, so it is spoken in full rather than
      // summarised down to a label and a truncated value.
      speech: `${result.heading}. ${result.body}`,
      facts: [],
      context,
      links: [{ href: "/guides/fantasy-football-terms", label: "Browse the glossary" }],
      caveats: [],
    };
  },
};

/** The term is already normalized to letters, digits and spaces, so this guards
 * against nothing today. It is here so a future change to normalization cannot
 * quietly turn a search term into a regex. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
