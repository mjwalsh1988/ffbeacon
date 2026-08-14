import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { resolveRateLimitActorKey } from "@/lib/rate-limit-actor";
import { buildBeamContext } from "@/lib/beam/context";
import { ask } from "@/lib/beam/engine";
import { validateQuestion } from "@/lib/beam/validate";
import { loadBeamSettings } from "@/lib/beam/settings";
import type { BeamOutcome } from "@/lib/beam/types";

/**
 * POST /api/beam/ask
 *
 * The only public entry point to BEAM. Everything about what BEAM knows lives in
 * lib/beam; this handler is transport, and deliberately boring.
 *
 * Defenses, in order:
 *   1. Same-origin header check, matching every sibling read endpoint.
 *   2. Length cap BEFORE parsing, so an oversized body is rejected on its size
 *      rather than tokenized to discover it is oversized.
 *   3. Durable per-actor rate limit through try_claim_rate_limit, keyed by auth
 *      user id or a salted IP hash the caller cannot rotate.
 *   4. A durable ceiling on the endpoint as a whole, claimed after the per-actor
 *      slot and split into a signed-in pool and a guest pool. Per-actor limits
 *      contain one abuser; they do nothing about a thousand addresses behaving
 *      individually reasonably.
 *
 * The engine never throws, so this route has no error path of its own beyond a
 * malformed body. An interpretation failure is a 200 with an unsupported
 * outcome, because "BEAM does not know that yet" is an answer and a 500 is not.
 *
 * The debug trace is computed on every request (it is free, it is the scorer's
 * own output) and returned to nobody. It is written to the query log for the
 * admin gaps board; this is the only web path into the engine.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_BUCKET = "beam_ask";

/**
 * The endpoint-wide ceiling, in TWO pools: one for signed-in readers and one for
 * guests, each with the configured budget.
 *
 * A single shared pool is a lever. The per-actor limit is 30 a minute and the
 * ceiling is 600, so twenty addresses can spend the whole thing and every other
 * visitor gets a 429 until the window turns over: a flood that used to degrade
 * only the attacker's own traffic would become a clean outage for everybody.
 * Splitting the pools does not stop that, but it confines it. Guest addresses
 * are cheap and signed-in accounts are not, so a guest flood can no longer
 * starve the people who signed in, and the two are visible separately in the
 * ledger rather than as one number that says "we are busy".
 *
 * Separate buckets also keep per-actor rejections and ceiling rejections apart:
 * one says somebody is hammering us, the other says we are at capacity, and
 * those call for different responses.
 */
const GLOBAL_BUCKET_USER = "beam_ask_global_user";
const GLOBAL_BUCKET_GUEST = "beam_ask_global_guest";
const GLOBAL_KEY = "all";

/** A 300-character question plus JSON overhead is well under this. */
const MAX_BODY_BYTES = 8 * 1024;

/** The schema's ceiling for limits.maxQuestionLength (lib/beam/settings.ts). */
const MAX_CONFIGURABLE_QUESTION_LENGTH = 500;

/** Hash the actor key again before it reaches the log, so the two never match. */
function logActorHash(actorKey: string): string {
  return createHash("sha256").update(`beam-log:${actorKey}`).digest("hex");
}

export async function POST(req: Request) {
  if (req.headers.get("x-requested-with") !== "ff-beacon") {
    return NextResponse.json({ error: "Invalid request" }, { status: 403 });
  }

  // Size before parse. A 300-character question plus JSON overhead fits in well
  // under 8 KB, and there is no built-in body cap on a route handler, so without
  // this the platform's multi-megabyte limit is the only ceiling and we would
  // buffer and parse all of it to discover it was too big.
  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "That request is too large." }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const raw = (body ?? {}) as Record<string, unknown>;

  // Checked against the schema's hard maximum, not the code default. The
  // admin-configured value can be anywhere in 40 to 500, and pre-checking
  // against 300 would silently make any configured value above it unreachable.
  // The settings-aware check below is the one that enforces the real limit.
  const preCheck = validateQuestion(raw.question, MAX_CONFIGURABLE_QUESTION_LENGTH);
  if (!preCheck.ok) {
    return NextResponse.json({ error: preCheck.error }, { status: 400 });
  }

  const supabase = await createClient();
  const admin = createAdminClient();

  // Settings BEFORE the limiters, so both limiters enforce what the admin
  // actually configured.
  //
  // This used to claim on the code defaults and then re-claim on a second
  // bucket only when the configured value was TIGHTER, which quietly made the
  // admin control one-directional: raising the ceiling for real growth saved,
  // displayed, and did nothing, because the default claim had already rejected.
  // A control that silently ignores half its range is worse than no control.
  //
  // The cost is one indexed single-row read, and it is not an extra one: the
  // settings are handed to buildBeamContext below, which would otherwise read
  // the same row itself. loadBeamSettings never throws; a broken row falls back
  // to the defaults rather than opening the gate.
  const settings = await loadBeamSettings(admin);
  const limits = settings.limits;

  const actorKey = await resolveRateLimitActorKey(req);

  // Claimed BEFORE the context build, not after.
  //
  // buildBeamContext is six operations including a Sleeper call on a cold
  // instance. Claiming afterwards meant a caller who was already over budget
  // still cost us all of that on every rejected request, which is the same
  // amplification shape as FFB-SEC-002.
  const preAllowed = await claimSlot(
    admin,
    actorKey,
    limits.askMaxPerWindow,
    limits.askWindowSeconds,
  );
  if (!preAllowed) {
    return tooMany(
      "That is a lot of questions in one minute. Give it a moment.",
      limits.askWindowSeconds,
    );
  }

  // The ceiling on the whole endpoint, claimed AFTER the per-actor slot and
  // never before it.
  //
  // That order is the whole design. A request the caller's own limit has already
  // rejected must not spend any of the shared budget, or one person hammering
  // the endpoint would push everybody else into a global rejection while being
  // rejected themselves. Per-actor first means the global counter only ever sees
  // traffic that was individually allowed.
  const globalAllowed = await claimSlot(
    admin,
    GLOBAL_KEY,
    limits.askGlobalMaxPerWindow,
    limits.askGlobalWindowSeconds,
    actorKey.startsWith("user:") ? GLOBAL_BUCKET_USER : GLOBAL_BUCKET_GUEST,
  );
  if (!globalAllowed) {
    // Deliberately not the per-actor wording. This reader has done nothing
    // wrong, and telling them they asked too much would be a lie about who is
    // busy.
    return tooMany(
      "BEAM is handling a lot of questions right now. Try again in a moment.",
      limits.askGlobalWindowSeconds,
    );
  }

  let ctx;
  try {
    ctx = await buildBeamContext(supabase, admin, {
      formatParam: typeof raw.format === "string" ? raw.format : undefined,
      sourceParam: typeof raw.source === "string" ? raw.source : undefined,
      settings,
    });
  } catch (err) {
    console.error("[beam/ask] context build failed", err);
    return NextResponse.json({ error: "BEAM is unavailable right now." }, { status: 503 });
  }

  // Re-validate the question against the admin-configured cap, which may be
  // tighter than the schema ceiling the pre-check used. Nothing else needs a
  // second claim: both limiters above already ran on the configured numbers.
  const validated = validateQuestion(raw.question, limits.maxQuestionLength);
  if (!validated.ok) {
    return NextResponse.json(
      { error: validated.error },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  let userId: string | null = null;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    userId = null;
  }

  const { outcome } = await ask(validated.value.question, ctx, {
    actorHash: logActorHash(actorKey),
    userId,
  });

  return NextResponse.json(
    { outcome: publicOutcome(outcome) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/**
 * Strip anything the client has no business seeing.
 *
 * Today the outcome is already public-safe (it is built from public data), but
 * making the boundary explicit means a future capability that carries an
 * internal field cannot leak it by default.
 */
function publicOutcome(outcome: BeamOutcome): BeamOutcome {
  return outcome;
}

/**
 * A 429 that tells the caller when to come back.
 *
 * Retry-After is the window itself, not a guess: the ledger uses a fixed window,
 * so a client retrying at half of it is still inside the same one and gets
 * rejected again. no-store because a cached rejection would outlive the window
 * that caused it.
 */
function tooMany(message: string, windowSeconds: number): NextResponse {
  return NextResponse.json(
    { error: message },
    {
      status: 429,
      headers: {
        "Retry-After": String(windowSeconds),
        "Cache-Control": "private, no-store",
      },
    },
  );
}

async function claimSlot(
  admin: ReturnType<typeof createAdminClient>,
  actorKey: string,
  max: number,
  windowSeconds: number,
  bucket: string = RATE_BUCKET,
): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc("try_claim_rate_limit" as never, {
      p_bucket: bucket,
      p_key: actorKey,
      p_max_requests: max,
      p_window_seconds: windowSeconds,
    } as never);
    if (error) throw new Error(error.message);
    return Boolean(data);
  } catch (err) {
    // Fail closed. A rate limiter that opens when the database hiccups is not a
    // rate limiter.
    console.error("[beam/ask] rate-limit check failed", err);
    return false;
  }
}
