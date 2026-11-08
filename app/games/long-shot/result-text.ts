/**
 * Pure: the words of a result (plan 5.3), shared by the result panel and the
 * state region so the screen and the announcement say the same thing.
 */

import { TIER_WORDS, type Mode, type ResultDto } from "@/lib/long-shot/types";

export function resultSentence(r: Pick<ResultDto, "state" | "tier" | "points" | "playerName">): string {
  if (r.state === "timed_out") return "Time ran out. 0 points.";
  if (r.state === "skipped") return "Skipped. 0 points.";
  if (!r.tier) return `${r.playerName ?? "That player"} is not an answer to this prompt. 0 points.`;
  return `${r.playerName ?? "Your answer"}: ${TIER_WORDS[r.tier]}, ${r.points} points.`;
}

export const ROOM_FIRST_FLOOR = 5;

export function roomLine(r: Pick<ResultDto, "state" | "roomCount" | "roomTotal">, mode: Mode): string {
  if (r.roomTotal < ROOM_FIRST_FLOOR) return "You are among the first to answer this prompt.";
  const prefix = mode === "hurry_up" ? "Today:" : "In that day's Hurry-Up room,";
  if (r.state !== "answered") return `${prefix} ${r.roomTotal} players have faced this prompt.`;
  return `${prefix} ${r.roomCount} of ${r.roomTotal} players gave this answer.`;
}
