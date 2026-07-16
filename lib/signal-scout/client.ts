/**
 * Browser-side fetch wrapper for the Signal Scout Phase 3 API routes.
 *
 * Every call attaches the required header guard (x-requested-with: ff-beacon)
 * and cache: "no-store", parses the JSON body defensively, and maps the
 * route's { error: <code> } shape to a small typed error surface (game-voice
 * messages) so the game UI never has to branch on raw HTTP status codes.
 *
 * ANTI-CHEAT NOTE: every DTO type imported here is a TYPE-ONLY import from
 * lib/signal-scout/round-engine, so no server code (Supabase client,
 * settings, engine logic) is ever pulled into the client bundle. Type-only
 * imports are erased at build time.
 */

import type {
  ActiveRoundDto,
  CompletedRoundDto,
  PurchaseHintSuccess,
} from "@/lib/signal-scout/round-engine";
import type { Board, LeaderboardRow } from "@/lib/signal-scout/leaderboards";
import type { SignalTierKey } from "@/lib/signal-scout/scoring";

/** Header that every Signal Scout route requires (CSRF-lite / bot filter). */
export const SCOUT_REQUEST_HEADER = { "x-requested-with": "ff-beacon" } as const;

/**
 * The routes always send { error: <code> } for a non-2xx response, and the
 * code IS the friendly-message key (unlike On The Clock, there is no
 * separate HTTP-status-to-code mapping layer here). "network" is a
 * client-only addition for a fetch that never reached the server.
 */
export type ApiErrorCode =
  | "active_round_exists"
  | "guest_limit_reached"
  | "guest_play_disabled"
  | "game_disabled"
  | "pool_empty"
  | "rate_limited"
  | "signal_burned"
  | "tier_limit_reached"
  | "tier_exhausted"
  | "burn_confirmation_required"
  | "tier_disabled"
  | "invalid_tier"
  | "guess_duplicate"
  | "guess_out_of_pool"
  | "not_found"
  | "round_not_active"
  | "invalid_request"
  | "forbidden"
  | "leaderboards_disabled"
  | "login_required"
  | "server_error"
  | "network";

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: ApiErrorCode; roundId?: string; message: string };

const ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  active_round_exists: "You already have a round in progress.",
  guest_limit_reached: "You are out of guest rounds for today. Sign in for unlimited play.",
  guest_play_disabled: "Guest play is off right now. Sign in to scout.",
  game_disabled: "Signal Scout is taking a breather. Check back soon.",
  pool_empty: "No signal to lock onto right now. Check back soon.",
  rate_limited: "Too fast. Give the signal a second and try again.",
  signal_burned: "That signal is already burned out. Take your best guess.",
  tier_limit_reached: "You have used every hint this tier offers for this round.",
  tier_exhausted: "No hints left to reveal in that tier.",
  burn_confirmation_required: "That hint would burn your signal to zero. Confirm to buy it anyway.",
  tier_disabled: "That signal tier is turned off right now.",
  invalid_tier: "That is not a valid signal tier.",
  guess_duplicate: "You already guessed that player.",
  guess_out_of_pool: "That player is not in today's pool. Try another name.",
  not_found: "We could not find that round.",
  round_not_active: "That round is no longer active.",
  invalid_request: "Please check what you entered and try again.",
  forbidden: "This request was blocked. Reload the page and try again.",
  leaderboards_disabled: "Leaderboards are offline right now. Check back soon.",
  login_required: "Sign in to see the leaderboards.",
  server_error: "Something went wrong. Try again shortly.",
  network: "Network error. Check your connection and try again.",
};

function isApiErrorCode(value: string): value is ApiErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, value);
}

/** Parse a JSON body defensively (routes always send JSON, but never assume). */
async function parseJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const body = await res.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function request<T>(
  input: string,
  init: RequestInit,
  shape: (body: Record<string, unknown>) => T,
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(input, {
      ...init,
      headers: { ...SCOUT_REQUEST_HEADER, ...(init.headers ?? {}) },
      cache: "no-store",
    });
  } catch (err) {
    // A deliberate abort (search debounce cancelling a stale request) is not
    // a network failure; let the caller's own abort handling see it.
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return { ok: false, status: 0, code: "network", message: ERROR_MESSAGES.network };
  }

  const body = await parseJson(res);
  if (!res.ok) {
    const rawCode = typeof body.error === "string" ? body.error : "";
    const code: ApiErrorCode = isApiErrorCode(rawCode) ? rawCode : "server_error";
    const roundId = typeof body.roundId === "string" ? body.roundId : undefined;
    return { ok: false, status: res.status, code, roundId, message: ERROR_MESSAGES[code] };
  }
  return { ok: true, data: shape(body) };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** POST /api/games/signal-scout/round */
export function startRound(): Promise<ApiResult<{ round: ActiveRoundDto }>> {
  return request("/api/games/signal-scout/round", { method: "POST" }, (body) => ({
    round: body.round as ActiveRoundDto,
  }));
}

/** GET /api/games/signal-scout/round/[id] */
export function fetchRound(
  roundId: string,
): Promise<ApiResult<{ round: ActiveRoundDto | CompletedRoundDto }>> {
  return request(
    `/api/games/signal-scout/round/${encodeURIComponent(roundId)}`,
    { method: "GET" },
    (body) => ({ round: body.round as ActiveRoundDto | CompletedRoundDto }),
  );
}

/** POST /api/games/signal-scout/round/[id]/hint */
export function purchaseHint(
  roundId: string,
  tier: SignalTierKey,
  confirmBurn: boolean,
): Promise<ApiResult<PurchaseHintSuccess>> {
  return request(
    `/api/games/signal-scout/round/${encodeURIComponent(roundId)}/hint`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier, confirmBurn }),
    },
    (body) => ({
      clue: body.clue as PurchaseHintSuccess["clue"],
      scoreAvailable: Number(body.scoreAvailable ?? 0),
      burned: Boolean(body.burned),
      hintsUsed: Number(body.hintsUsed ?? 0),
      tierPurchasesRemaining: body.tierPurchasesRemaining as PurchaseHintSuccess["tierPurchasesRemaining"],
      lockedCounts: body.lockedCounts as PurchaseHintSuccess["lockedCounts"],
    }),
  );
}

/** POST /api/games/signal-scout/round/[id]/guess */
export function submitGuess(
  roundId: string,
  guessedPlayerId: string,
): Promise<ApiResult<{ round: ActiveRoundDto | CompletedRoundDto }>> {
  return request(
    `/api/games/signal-scout/round/${encodeURIComponent(roundId)}/guess`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guessedPlayerId }),
    },
    (body) => ({ round: body.round as ActiveRoundDto | CompletedRoundDto }),
  );
}

/** POST /api/games/signal-scout/round/[id]/skip */
export function skipRound(roundId: string): Promise<ApiResult<{ round: CompletedRoundDto }>> {
  return request(
    `/api/games/signal-scout/round/${encodeURIComponent(roundId)}/skip`,
    { method: "POST" },
    (body) => ({ round: body.round as CompletedRoundDto }),
  );
}

export interface SearchPlayerResult {
  id: string;
  name: string;
  position: string | null;
  team: string | null;
  sleeperId: string | null;
}

/**
 * One board page, exactly as lib/signal-scout/leaderboards.ts LeaderboardView
 * models it server-side, plus the (board, page) echo the route sends back.
 */
export interface LeaderboardViewDto {
  board: Board;
  page: number;
  rows: LeaderboardRow[];
  yourRank: LeaderboardRow | null;
  totalPages: number;
}

/**
 * GET /api/games/signal-scout/leaderboards?board=&page=
 *
 * Drives the in-place board switching and pagination in the game page's
 * leaderboard rail. The rail server-renders page 1 of the default board, so
 * this only fires once the visitor changes board or page.
 */
export function fetchLeaderboard(board: Board, page: number): Promise<ApiResult<LeaderboardViewDto>> {
  const qs = new URLSearchParams({ board, page: String(page) }).toString();
  return request(`/api/games/signal-scout/leaderboards?${qs}`, { method: "GET" }, (body) => ({
    board: body.board as Board,
    page: Number(body.page ?? 1),
    rows: Array.isArray(body.rows) ? (body.rows as LeaderboardRow[]) : [],
    yourRank: (body.yourRank ?? null) as LeaderboardRow | null,
    totalPages: Number(body.totalPages ?? 1),
  }));
}

/** GET /api/games/signal-scout/search?q= (round-independent; safe to call before a round exists). */
export function searchPlayers(
  q: string,
  opts?: { signal?: AbortSignal },
): Promise<ApiResult<{ results: SearchPlayerResult[] }>> {
  const qs = new URLSearchParams({ q }).toString();
  return request(
    `/api/games/signal-scout/search?${qs}`,
    { method: "GET", signal: opts?.signal },
    (body) => ({
      results: Array.isArray(body.results) ? (body.results as SearchPlayerResult[]) : [],
    }),
  );
}
