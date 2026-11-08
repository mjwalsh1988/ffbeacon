/**
 * Pure: the field strip's records for an attempt, from the answered summaries
 * plus dim placeholders for the prompts still to play.
 */

import type { StripRecord } from "@/components/long-shot/field-strip";
import type { AnswerSummaryDto } from "@/lib/long-shot/types";

export function stripRecords(answers: readonly AnswerSummaryDto[], promptCount: number): StripRecord[] {
  const out: StripRecord[] = [];
  for (let pos = 1; pos <= promptCount; pos++) {
    const a = answers.find((x) => x.position === pos && x.state !== "pending");
    out.push(
      a
        ? {
            position: pos,
            tier: a.tier,
            points: a.points,
            playerName: a.playerName,
            sleeperId: a.sleeperId,
            teamCode: a.teamCode,
            state: a.state as StripRecord["state"],
          }
        : { position: pos, tier: null, points: 0, playerName: null, pending: true, state: "pending" },
    );
  }
  return out;
}
