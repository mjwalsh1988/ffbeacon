/**
 * The merge gate: does a post we already know belongs to a published story actually
 * change that story?
 *
 * WHY THIS SITS BETWEEN THE MATCH AND THE REWRITE
 *
 * Recognising a duplicate is only half the saving. Most follow-up posts about a story
 * we have already covered add nothing a reader would act on. "More about Colts
 * Pro-Bowl RB Jonathan Taylor agreeing to 2-year, $44 million extension, via
 * @HolderStephen" restates the contract the article already reports, in fewer words,
 * with a link. Rewriting the article for that spends money, bumps last_updated, writes
 * a revision snapshot, and shows the reader an "Updated" line for a change that is not
 * one.
 *
 * So a matched post is asked one cheap question before anything is written. If the
 * answer is no, the post is recorded against the story, its Discord card stays where
 * it is, and the article is left exactly as it was. Nothing else runs.
 *
 * The three Jonathan Taylor follow-ups, the two Skoronski posts, and the beat-writer
 * echo in almost every cluster all take that path. What does not: "The Falcons now have
 * confirmed that Jalon Walker will miss the 2026 season due to the torn ACL he suffered
 * Tuesday", which turns a feared injury into a confirmed season-ending one. That is
 * worth a rewrite, and it gets one.
 *
 * The gate runs on the triage model, so a no costs a fraction of a cent against a
 * rewrite that costs a few cents and a fresh article that costs the better part of a
 * dollar once web research is counted.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { logBeaconBrief, runStructuredCall } from "./ai";
import type { BeaconBriefSettings } from "./settings";

type Admin = SupabaseClient<Database>;

export const MERGE_GATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["adds_new_information", "what_is_new"],
  properties: {
    adds_new_information: { type: "boolean" },
    what_is_new: { type: "string" },
  },
} as const;

export interface MergeGateResult {
  /** True when the article needs to change to stay accurate or complete. */
  addsNewInformation: boolean;
  /** One clause naming what is new. Empty when nothing is. */
  whatIsNew: string;
  /** True when the model could not be reached and we defaulted to rewriting. */
  degraded: boolean;
}

/**
 * Ask whether the post carries a fact the article does not already state.
 *
 * FAILS OPEN, ON PURPOSE. A failed call returns addsNewInformation: true, which sends
 * the post down the rewrite path. The alternative, defaulting to "no", would silently
 * discard real updates whenever the API had a bad minute, and a stale article that
 * says a player is week-to-week when he is out for the season is a worse outcome than
 * one wasted rewrite.
 */
export async function postAddsNewInformation(args: {
  admin: Admin;
  settings: BeaconBriefSettings;
  article: {
    title: string | null;
    tl_dr: string | null;
    content_md: string | null;
  };
  /** Compact, model-facing view of the post. */
  post: unknown;
  ingestionId: string;
}): Promise<MergeGateResult> {
  const { admin, settings, article, post, ingestionId } = args;

  if (!settings.mergeGateEnabled || !settings.prompts.mergeGate) {
    return { addsNewInformation: true, whatIsNew: "", degraded: false };
  }

  const verdict = await runStructuredCall<{
    adds_new_information: boolean;
    what_is_new: string;
  }>({
    admin,
    stage: "revision_triage",
    model: settings.modelTriage,
    system: settings.prompts.mergeGate,
    userContent: JSON.stringify({
      existing_article: {
        title: article.title ?? "",
        summary: article.tl_dr ?? "",
        body_md: article.content_md ?? "",
      },
      new_post: post,
    }),
    schema: MERGE_GATE_SCHEMA as unknown as Record<string, unknown>,
    ingestionId,
    maxTokens: 256,
  });

  if (!verdict) {
    await logBeaconBrief(admin, {
      stage: "revision_triage",
      level: "warn",
      ingestionId,
      message:
        "merge gate call failed; rewriting rather than risk leaving the article stale",
    });
    return { addsNewInformation: true, whatIsNew: "", degraded: true };
  }

  return {
    addsNewInformation: verdict.adds_new_information === true,
    whatIsNew: verdict.what_is_new?.trim() ?? "",
    degraded: false,
  };
}
