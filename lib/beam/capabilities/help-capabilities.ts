/**
 * "What can I ask?"
 *
 * The one question a first-time reader actually has, and the one BEAM used to
 * answer worst: the four starter chips show four questions, and nothing on the
 * surface says whether those are the whole menu or a sample of it. Someone who
 * reads them as the whole menu never finds out that season stats go back to
 * 2020, or that the draft board is in here.
 *
 * The answer is BUILT FROM THE REGISTRY, never written down. A hand-written list
 * of what BEAM can do would be wrong the first time a capability is added or
 * switched off in the admin, and being wrong about your own abilities is a
 * particularly bad way to be wrong. Reading `enabledCapabilities` means the
 * answer reflects the same list the router uses, in the same request.
 *
 * The import of the registry is circular (the registry imports this module to
 * register it) and safe: nothing here touches the registry until run() is
 * called, long after both modules have finished evaluating.
 */

import { z } from "zod";
import type { BeamAnswer, BeamCapability } from "@/lib/beam/types";
import { buildContext } from "@/lib/beam/answers/templates";
import { enabledCapabilities } from "./index";
import { orderForReaders } from "@/lib/beam/examples";
import { parseWith } from "./shared";

// No parameters. The question has no subject, no season, and no player in it,
// and an empty object is the honest way to say so.
const schema = z.object({});

type Params = z.infer<typeof schema>;

type Topic = {
  label: string;
  description: string;
  /** One question that lands on this capability. Null if it declares none. */
  example: string | null;
};

type Result = { topics: Topic[] };

export const helpCapabilities: BeamCapability<Params, Result> = {
  id: "help.capabilities",
  label: "What BEAM can answer",
  description:
    "The list of question types BEAM handles, built from the live registry.",
  playerScope: "historical",
  declineMessage:
    "Every kind of question is switched off right now, so there is nothing to list.",
  matcher: {
    base: 0.6,
    required: ["help"],
    optional: [],
    heads: ["what is", "what does"],
    playerCount: 0,
  },
  examples: [
    "What type of questions can I ask?",
    "What can you do?",
    "What data do you have?",
  ],

  parse: (raw) => parseWith(schema, raw),

  async run(_params, ctx): Promise<Result | null> {
    const live = enabledCapabilities(ctx.settings.capabilities.disabled).filter(
      // Listing itself would be a line that reads "ask me what you can ask me".
      (capability) => capability.id !== "help.capabilities",
    );
    if (live.length === 0) return null;

    // Reading order, not registry order: the registry leads with the narrowest
    // shapes we answer, and a menu that opens on "compare projection beat
    // rates" reads like a menu for somebody else. Shared with the starter chips
    // so the first thing a reader sees and the full list agree.
    const ordered = orderForReaders(live);

    return {
      topics: ordered.map((capability) => ({
        label: capability.label,
        description: capability.description,
        example: capability.examples[0] ?? null,
      })),
    };
  },

  present(result): BeamAnswer {
    const headline = `I answer ${result.topics.length} kinds of question, all from FF Beacon's own data.`;

    // One paragraph per topic. The answer card splits `body` on blank lines and
    // keeps single newlines, so the example sits under its topic rather than
    // running on from it.
    const body = result.topics
      .map((topic) => {
        const line = `${topic.label}. ${topic.description}`;
        return topic.example ? `${line}\nFor example: ${topic.example}` : line;
      })
      .join("\n\n");

    // Spoken as label and description only. Reading fourteen topics AND their
    // examples aloud is a minute of speech before the reader can ask anything;
    // the examples stay on screen for whoever wants to read them, and the
    // closing sentence says they are there.
    const spoken = result.topics
      .map((topic) => `${topic.label}. ${topic.description}`)
      .join(" ");

    return {
      headline,
      body,
      speech: `${headline} ${spoken} Each one has an example question written out in the answer on screen. Type any of them, or ask in your own words. I cannot see your league, so questions about your own roster go to League Pulse.`,
      facts: [],
      context: buildContext({
        note: "Built from what BEAM can answer right now, so it is never out of date.",
      }),
      links: [
        { href: "/rankings", label: "Browse the rankings board" },
        {
          href: "/tools/league-pulse",
          label: "Sync your league in League Pulse",
        },
      ],
      caveats: [
        "I cannot see your league yet, so roster, lineup, and trade-offer questions are for League Pulse and Signal Check.",
      ],
    };
  },
};
