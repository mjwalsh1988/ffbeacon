/**
 * Shared hardening for every Long Shot route (plan 17 preamble).
 *
 * Order, every route: same-origin header guard (403), signed-in user (401),
 * settings game_enabled (503), then zod on the body, then the rate claim,
 * then the engine. Every response is private no-store JSON. The header guard
 * and privateJson are Signal Scout's, re-exported rather than copied.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextResponse } from "next/server";
import type { Database } from "@/lib/database.types";
import { currentEasternGameDate } from "@/lib/game-date";
import { claimRateLimitSlot } from "@/lib/rate-limit-claim";
import { privateJson, requireFfBeaconHeader, uuidSchema } from "@/lib/signal-scout/route-helpers";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { LONG_SHOT_ERROR_STATUS, isLongShotError, type LongShotErrorCode } from "./errors";
import { loadLongShotSettings } from "./settings";
import type { LongShotSettings } from "./types";

export { privateJson, requireFfBeaconHeader, uuidSchema };

export const RATE_BUCKETS = {
  start: { bucket: "long-shot-start", max: 6, windowSeconds: 60 },
  next: { bucket: "long-shot-next", max: 30, windowSeconds: 60 },
  answer: { bucket: "long-shot-answer", max: 30, windowSeconds: 60 },
  state: { bucket: "long-shot-state", max: 30, windowSeconds: 60 },
  search: { bucket: "long-shot-search", max: 20, windowSeconds: 10 },
  boards: { bucket: "long-shot-boards", max: 60, windowSeconds: 60 },
} as const;

export type RateKind = keyof typeof RATE_BUCKETS;

/** Fails closed: a limiter outage refuses rather than lets everything through. */
export function claim(kind: RateKind): Promise<boolean> {
  return claimRateLimitSlot(RATE_BUCKETS[kind]);
}

export function errorJson(code: LongShotErrorCode): NextResponse {
  return privateJson({ error: code }, LONG_SHOT_ERROR_STATUS[code]);
}

export async function requireUser(): Promise<{ id: string } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { id: user.id } : null;
}

export interface Guarded {
  ok: true;
  userId: string;
  admin: SupabaseClient<Database>;
  settings: LongShotSettings;
  today: string;
}

export async function guardRequest(req: Request): Promise<Guarded | { ok: false; response: NextResponse }> {
  if (!requireFfBeaconHeader(req)) return { ok: false, response: errorJson("forbidden") };
  const user = await requireUser();
  if (!user) return { ok: false, response: errorJson("login_required") };
  const admin = createAdminClient();
  const settings = await loadLongShotSettings(admin);
  if (!settings.game_enabled) return { ok: false, response: errorJson("game_disabled") };
  return { ok: true, userId: user.id, admin, settings, today: currentEasternGameDate() };
}

/** A LongShotError becomes its code; anything else is logged and a generic 500. */
export function handleRouteError(err: unknown, label: string): NextResponse {
  if (isLongShotError(err)) return errorJson(err.code);
  console.error(`[long-shot] ${label} failed`, err);
  return errorJson("server_error");
}

/** Read a JSON body without throwing; a malformed body is an empty object. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}
