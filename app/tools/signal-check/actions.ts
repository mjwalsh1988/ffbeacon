"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
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

type AnalysisInsert = Database["public"]["Tables"]["signal_check_analyses"]["Insert"];

export type RunSignalCheckResult =
  | { ok: true; view: BuilderView; shareId: string | null; shareUrl: string | null }
  | { ok: false; error: string };

/**
 * Analyze a manually built trade entirely server-side. The client only submits
 * asset references (player ids + pick descriptors) and a format slug; values,
 * totals, margin, and verdict are computed here and never trusted from input.
 */
export async function runSignalCheck(
  raw: unknown,
  opts?: { save?: boolean; makePublic?: boolean },
): Promise<RunSignalCheckResult> {
  const admin = createAdminClient();

  const settings = await loadSignalCheckSettings(admin);
  if (!settings.enabled) {
    return { ok: false, error: "Signal Check is currently unavailable." };
  }

  const parsed = analysisInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "That trade could not be read. Please rebuild it and try again." };
  }
  const input = parsed.data;

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
    });

    const view = toBuilderView(analysis, settings);

    let shareId: string | null = null;
    if (opts?.save && settings.shareLinksEnabled) {
      const cookieClient = await createClient();
      const {
        data: { user },
      } = await cookieClient.auth.getUser();
      const id = crypto.randomUUID();
      const row = freezeAnalysis({
        analysis,
        input,
        settings,
        shareId: id,
        userId: user?.id ?? null,
        isPublic: Boolean(opts.makePublic),
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
      shareUrl: shareId ? `${SITE.url}/tools/signal-check/v/${shareId}` : null,
    };
  } catch (err) {
    if (err instanceof SignalCheckError) {
      return { ok: false, error: err.message };
    }
    console.error("[signal-check] analysis failed", err);
    return { ok: false, error: "Something went wrong analyzing that trade. Please try again." };
  }
}
