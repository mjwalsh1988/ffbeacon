/**
 * "How old is Brock Purdy?" / "Who is Ladd McConkey?"
 *
 * Identity facts, no format and no source: an age is the same number in every
 * league. The injury designation comes from the Sleeper payload we already store
 * on the player row, so this is one read of one row.
 */

import { z } from "zod";
import type { BeamAnswer, BeamCapability } from "@/lib/beam/types";
import { computeAgeDecimal } from "@/lib/player-age";
import { NFL_TEAMS } from "@/lib/nfl-teams";
import { buildContext, buildSpeech, positionNoun } from "@/lib/beam/answers/templates";
import { parseWith, playerLink, playerRefSchema } from "./shared";

const schema = z.object({ player: playerRefSchema });
type Params = z.infer<typeof schema>;

type Result = {
  age: number | null;
  birthDate: string | null;
  college: string | null;
  yearsExperience: number | null;
  draftYear: number | null;
  draftRound: number | null;
  draftPick: number | null;
  heightInches: number | null;
  weightLbs: number | null;
  injuryStatus: string | null;
  status: string | null;
};

export const playerBio: BeamCapability<Params, Result> = {
  id: "player.bio",
  label: "Player profile facts",
  description: "Age, team, experience, college, and injury status for one player.",
  playerScope: "historical",
  declineMessage: "We do not hold profile details for that player.",
  matcher: {
    base: 0.35,
    required: ["player"],
    optional: [],
    heads: ["how old is", "who is"],
    playerCount: 1,
  },
  examples: [
    "How old is Brock Purdy?",
    "Who is Ladd McConkey?",
    "What college did Bijan Robinson go to?",
  ],

  parse: (raw) => parseWith(schema, raw),

  async run(params, ctx) {
    const { data } = await ctx.supabase
      .from("players")
      .select(
        "birth_date, college, years_experience, draft_year, draft_round, draft_pick, height_inches, weight_lbs, status, injury_status:metadata->sleeper->>injury_status",
      )
      .eq("id", params.player.id)
      .maybeSingle();

    if (!data) {
      return {
        age: null,
        birthDate: null,
        college: null,
        yearsExperience: null,
        draftYear: null,
        draftRound: null,
        draftPick: null,
        heightInches: null,
        weightLbs: null,
        injuryStatus: null,
        status: null,
      };
    }

    const row = data as unknown as {
      birth_date: string | null;
      college: string | null;
      years_experience: number | null;
      draft_year: number | null;
      draft_round: number | null;
      draft_pick: number | null;
      height_inches: number | null;
      weight_lbs: number | null;
      status: string | null;
      injury_status: string | null;
    };

    const ageDecimal = computeAgeDecimal(row.birth_date);
    return {
      age: ageDecimal === null ? null : Math.floor(ageDecimal),
      birthDate: row.birth_date,
      college: row.college,
      yearsExperience: row.years_experience,
      draftYear: row.draft_year,
      draftRound: row.draft_round,
      draftPick: row.draft_pick,
      heightInches: row.height_inches,
      weightLbs: row.weight_lbs,
      injuryStatus: row.injury_status && row.injury_status.trim() ? row.injury_status.trim() : null,
      status: row.status,
    };
  },

  present(result, params): BeamAnswer {
    const player = params.player;
    // Spelled out, not "26 years old, QB, SF", which a screen reader reads as
    // "Q B, S F". This is the one capability whose entire output is a
    // plain-language identity sentence, so the codes cannot stay in it.
    const role = player.position ? positionNoun(player.position) : null;
    const team = player.team ? teamName(player.team) : null;
    let headline: string;
    if (result.age !== null && role) {
      headline = team
        ? `${player.name} is a ${result.age} year old ${role} for the ${team}.`
        : `${player.name} is a ${result.age} year old ${role}.`;
    } else if (role) {
      headline = team
        ? `${player.name} is a ${role} for the ${team}.`
        : `${player.name} is a ${role}.`;
    } else if (result.age !== null) {
      headline = `${player.name} is ${result.age} years old.`;
    } else {
      headline = `Here is what we hold on ${player.name}.`;
    }

    const facts: Array<{ label: string; value: string }> = [];
    if (result.age !== null) facts.push({ label: "Age", value: String(result.age) });
    if (player.position) facts.push({ label: "Position", value: player.position });
    if (player.team) facts.push({ label: "Team", value: player.team });
    if (result.yearsExperience !== null) {
      facts.push({
        label: "Experience",
        value:
          result.yearsExperience === 0
            ? "Rookie"
            : `${result.yearsExperience} ${result.yearsExperience === 1 ? "season" : "seasons"}`,
      });
    }
    if (result.college) facts.push({ label: "College", value: result.college });
    if (result.draftYear && result.draftRound && result.draftPick) {
      facts.push({
        label: "Drafted",
        value: `${result.draftYear}, round ${result.draftRound}, pick ${result.draftPick}`,
      });
    }
    if (result.heightInches) {
      const feet = Math.floor(result.heightInches / 12);
      const inches = result.heightInches % 12;
      const size = result.weightLbs
        ? `${feet} foot ${inches}, ${result.weightLbs} pounds`
        : `${feet} foot ${inches}`;
      facts.push({ label: "Size", value: size });
    }

    const caveats: string[] = [];
    // An injury designation is the one fact here that goes stale fast, so it is
    // stated as a designation rather than as a description of how he feels.
    if (result.injuryStatus) {
      caveats.push(`Sleeper currently lists him as ${result.injuryStatus}.`);
    }

    const context = buildContext({ note: "Profile data from the Sleeper player feed." });

    return {
      headline,
      speech: buildSpeech({ headline, facts, caveats, context, maxFacts: facts.length }),
      facts,
      context,
      links: [playerLink(player)],
      caveats,
    };
  },
};

/** "SF" reads as "S F" aloud. The full nickname does not. */
function teamName(code: string): string {
  const team = NFL_TEAMS.find((t) => t.code === code);
  if (!team) return code;
  const parts = team.name.split(" ");
  return parts[parts.length - 1];
}
