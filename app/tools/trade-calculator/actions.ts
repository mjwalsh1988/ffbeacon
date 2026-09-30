"use server";

import { createClient } from "@/lib/supabase/server";
import {
  analyzeManualTrade,
  claimSignalCheckRunSlot,
  claimSignalCheckSaveSlot,
  parseManualTradeInput,
  SLOW_DOWN_MESSAGE,
  UNREADABLE_TRADE_MESSAGE,
  type RunSignalCheckResult,
} from "@/lib/signal-check/run-manual";

export type { RunSignalCheckResult } from "@/lib/signal-check/run-manual";

/**
 * Analyze a manually built trade entirely server-side. The client only submits
 * asset references (player ids + pick descriptors) and a format slug; values,
 * totals, margin, and verdict are computed here and never trusted from input.
 *
 * Open to guests, so it is ordered like every other public action here:
 * validate, then meter, then work. Every call claims a slot in the shared run
 * bucket. A SAVE (which writes a row with the service role and publishes a
 * share page) claims a second, much smaller one: a signed-in reader's
 * allowance, or a guest's few an hour. A guest can only save a PUBLIC link,
 * because a private row with no owner is a row nobody can ever open.
 */
export async function runSignalCheck(
  raw: unknown,
  opts?: { save?: boolean; makePublic?: boolean },
): Promise<RunSignalCheckResult> {
  const input = parseManualTradeInput(raw);
  if (!input) {
    return { ok: false, error: UNREADABLE_TRADE_MESSAGE };
  }

  if (!(await claimSignalCheckRunSlot())) {
    return { ok: false, error: SLOW_DOWN_MESSAGE };
  }

  let save: { userId: string | null; isPublic: boolean } | null = null;
  if (opts?.save === true) {
    const cookieClient = await createClient();
    const {
      data: { user },
    } = await cookieClient.auth.getUser();
    const isPublic = opts.makePublic === true;
    if (!user && !isPublic) {
      return { ok: false, error: "Sign in to save a private copy of this check." };
    }
    if (!(await claimSignalCheckSaveSlot(Boolean(user)))) {
      return {
        ok: false,
        error: user
          ? "You have made a lot of share links recently. Try again later."
          : "You have made a lot of share links recently. Sign in to make more, or try again later.",
      };
    }
    save = { userId: user?.id ?? null, isPublic };
  }

  return analyzeManualTrade(input, save);
}
