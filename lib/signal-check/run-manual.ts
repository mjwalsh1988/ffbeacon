import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { SITE } from "@/lib/site";
import type { Database } from "@/lib/database.types";
import { analysisInputSchema } from "@/lib/signal-check/rules/schema";
import { loadSignalCheckSettings, loadActiveRuleset } from "@/lib/signal-check/settings";
import { resolveFormat } from "@/lib/signal-check/format";
import { buildValueResolver } from "@/lib/signal-check/values";
import { runPipeline } from "@/lib/signal-check/pipeline";
import { freezeAnalysis } from "@/lib/signal-check/freeze";
import { SignalCheckError } from "@/lib/signal-check/errors";
import { toBuilderView, type BuilderView } from "@/lib/signal-check/builder-view";
import { claimRateLimitSlot } from "@/lib/rate-limit-claim";

type AnalysisInsert = Database["public"]["Tables"]["signal_check_analyses"]["Insert"];

export type RunSignalCheckResult =
  | { ok: true; view: BuilderView; shareId: string | null; shareUrl: string | null }
  | { ok: false; error: string };

type ParsedInput = ReturnType<typeof analysisInputSchema.parse>;

export const UNREADABLE_TRADE_MESSAGE =
  "That trade could not be read. Please rebuild it and try again.";
export const SLOW_DOWN_MESSAGE = "Slow down a moment and try that again.";

/**
 * Rate limits for the manual Signal Check paths.
 *
 * Every analysis is a handful of database reads with no session required, so
 * every call is metered: the builder's server action and the draft room's.
 * One bucket for both, so switching surfaces does not buy a second budget.
 *
 * Saving is metered SEPARATELY and much more tightly, because a save writes a
 * row with the service role and publishes a share page. A signed-in reader gets
 * a working allowance; a guest gets a few an hour, enough for the share button
 * to keep working for a real person and far too few to fill the table.
 */
export const SIGNAL_CHECK_RUN_BUCKET = "signal-check-run";
export const SIGNAL_CHECK_RUN_MAX = 30;
export const SIGNAL_CHECK_RUN_WINDOW_SECONDS = 60;

export const SIGNAL_CHECK_SAVE_BUCKET_MEMBER = "signal-check-save-member";
export const SIGNAL_CHECK_SAVE_MAX_MEMBER = 30;
export const SIGNAL_CHECK_SAVE_BUCKET_GUEST = "signal-check-save-guest";
export const SIGNAL_CHECK_SAVE_MAX_GUEST = 3;
export const SIGNAL_CHECK_SAVE_WINDOW_SECONDS = 3600;

/** Parse untrusted input. Null means refuse before any other work. */
export function parseManualTradeInput(raw: unknown): ParsedInput | null {
  const parsed = analysisInputSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function claimSignalCheckRunSlot(): Promise<boolean> {
  return claimRateLimitSlot({
    bucket: SIGNAL_CHECK_RUN_BUCKET,
    max: SIGNAL_CHECK_RUN_MAX,
    windowSeconds: SIGNAL_CHECK_RUN_WINDOW_SECONDS,
  });
}

export function claimSignalCheckSaveSlot(signedIn: boolean): Promise<boolean> {
  return claimRateLimitSlot({
    bucket: signedIn ? SIGNAL_CHECK_SAVE_BUCKET_MEMBER : SIGNAL_CHECK_SAVE_BUCKET_GUEST,
    max: signedIn ? SIGNAL_CHECK_SAVE_MAX_MEMBER : SIGNAL_CHECK_SAVE_MAX_GUEST,
    windowSeconds: SIGNAL_CHECK_SAVE_WINDOW_SECONDS,
  });
}

/**
 * Run the pipeline on an already parsed, already metered trade. Values,
 * totals, margin and verdict are computed here and never trusted from input.
 * `save` is decided by the caller AFTER its own checks; null means do not save.
 */
export async function analyzeManualTrade(
  input: ParsedInput,
  save: { userId: string | null; isPublic: boolean } | null,
): Promise<RunSignalCheckResult> {
  const admin = createAdminClient();

  const settings = await loadSignalCheckSettings(admin);
  if (!settings.enabled) {
    return { ok: false, error: "Signal Check is currently unavailable." };
  }

  const format = await resolveFormat(admin, input.formatSlug);
  if (!format) {
    return { ok: false, error: "That format is not supported by FF Beacon Values." };
  }

  try {
    const built = await buildValueResolver(admin, format, input);
    const ruleset = await loadActiveRuleset(admin);
    const analysis = runPipeline({
      input,
      resolver: built.resolver,
      format,
      source: built.source,
      settings,
      rules: ruleset.rules,
      rulesetVersion: ruleset.version,
      poolMax: built.poolMax,
    });

    const view = toBuilderView(analysis, settings);

    let shareId: string | null = null;
    if (save && settings.shareLinksEnabled) {
      const id = crypto.randomUUID();
      const row = freezeAnalysis({
        analysis,
        input,
        settings,
        shareId: id,
        userId: save.userId,
        isPublic: save.isPublic,
        createdAtIso: new Date().toISOString(),
      });
      const { error } = await admin
        .from("signal_check_analyses")
        .insert(row as unknown as AnalysisInsert);
      if (error) {
        console.error("[signal-check] failed to save analysis", error);
      } else {
        shareId = id;
      }
    }

    return {
      ok: true,
      view,
      shareId,
      shareUrl: shareId ? `${SITE.url}/tools/trade-calculator/v/${shareId}` : null,
    };
  } catch (err) {
    if (err instanceof SignalCheckError) {
      return { ok: false, error: err.message };
    }
    console.error("[signal-check] analysis failed", err);
    return { ok: false, error: "Something went wrong analyzing that trade. Please try again." };
  }
}
