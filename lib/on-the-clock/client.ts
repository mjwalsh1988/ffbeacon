/**
 * Browser-side fetch wrappers for the On The Clock Phase 3 routes.
 *
 * The client NEVER calls Sleeper or Supabase-write paths directly: it goes through
 * these three thin wrappers, which always attach the required header guard
 * (x-requested-with: ff-beacon) and map HTTP status codes to a small, typed set of
 * UI states so the cockpit can render clean loading / error / disabled / throttled
 * / no-leagues states instead of leaking raw responses.
 *
 * No Sleeper access, no service-role, no polling. Each function performs exactly
 * one fetch when called; nothing here schedules repeats.
 */

import type { LeagueCard, PlayerPool, ShapedDraftCache, SyncStatus } from "./types";
import type { BoardResult } from "./board-types";
import type { DraftSnapshotPayload } from "./snapshot-types";
import type { HistoryTransaction } from "./trade-history";

/** Header that every On The Clock route requires (CSRF-lite / bot filter). */
export const OTC_REQUEST_HEADER = { "x-requested-with": "ff-beacon" } as const;

export type ApiErrorCode =
  | "feature-disabled"
  | "throttled"
  | "not-found"
  | "bad-input"
  | "forbidden"
  | "server"
  | "network";

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: ApiErrorCode; message: string };

function codeForStatus(status: number): ApiErrorCode {
  switch (status) {
    case 400:
      return "bad-input";
    case 403:
      return "forbidden";
    case 404:
      return "not-found";
    case 429:
      return "throttled";
    case 503:
      return "feature-disabled";
    default:
      return "server";
  }
}

function defaultMessage(code: ApiErrorCode): string {
  switch (code) {
    case "feature-disabled":
      return "On The Clock is not enabled yet.";
    case "throttled":
      return "Too many lookups. Try again in a few seconds.";
    case "not-found":
      return "We could not find that.";
    case "bad-input":
      return "Please check what you entered and try again.";
    case "forbidden":
      return "This request was blocked. Reload the page and try again.";
    case "network":
      return "Network error. Check your connection and try again.";
    default:
      return "Something went wrong. Try again shortly.";
  }
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
      headers: { ...OTC_REQUEST_HEADER, ...(init.headers ?? {}) },
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, code: "network", message: defaultMessage("network") };
  }

  const body = await parseJson(res);
  if (!res.ok) {
    const code = codeForStatus(res.status);
    const message = typeof body.error === "string" && body.error ? body.error : defaultMessage(code);
    return { ok: false, status: res.status, code, message };
  }
  return { ok: true, data: shape(body) };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export interface LeaguesResponse {
  season: string;
  /** Resolved Sleeper user id, used for connected-team detection. */
  userId: string | null;
  leagues: LeagueCard[];
  truncated: boolean;
}

/** GET /api/on-the-clock/leagues?username=&season= */
export function fetchLeagues(username: string, season: string): Promise<ApiResult<LeaguesResponse>> {
  const qs = new URLSearchParams({ username, season }).toString();
  return request(`/api/on-the-clock/leagues?${qs}`, { method: "GET" }, (body) => ({
    season: typeof body.season === "string" ? body.season : season,
    userId: typeof body.userId === "string" ? body.userId : null,
    leagues: Array.isArray(body.leagues) ? (body.leagues as LeagueCard[]) : [],
    truncated: Boolean(body.truncated),
  }));
}

/**
 * GET /api/on-the-clock/board?format=&pool= (FF Beacon ranked board for the
 * league's auto-detected format; source is forced to FF Beacon server-side).
 * `pool` only steers which Sleeper ADP market the board's adp values use
 * (rookie drafts prefer rookie ADP when it has data).
 */
export function fetchBoard(
  formatSlug: string,
  pool: PlayerPool = "everyone",
): Promise<ApiResult<{ board: BoardResult }>> {
  const qs = new URLSearchParams({ format: formatSlug, pool }).toString();
  return request(`/api/on-the-clock/board?${qs}`, { method: "GET" }, (body) => ({
    board: body.board as BoardResult,
  }));
}

export interface SnapshotResponse {
  /** Null when the draft is not complete (live mode applies) or no board data exists. */
  snapshot: DraftSnapshotPayload | null;
  reason: string | null;
}

/**
 * GET /api/on-the-clock/draft/snapshot?draft_id=&format=&league_name=
 * Finalized results for a completed draft (created server-side on first open).
 */
export function fetchSnapshot(params: {
  draftId: string;
  formatSlug?: string | null;
  leagueName?: string | null;
}): Promise<ApiResult<SnapshotResponse>> {
  const qp = new URLSearchParams({ draft_id: params.draftId });
  if (params.formatSlug) qp.set("format", params.formatSlug);
  if (params.leagueName) qp.set("league_name", params.leagueName);
  return request(`/api/on-the-clock/draft/snapshot?${qp.toString()}`, { method: "GET" }, (body) => ({
    snapshot: (body.snapshot as DraftSnapshotPayload | null) ?? null,
    reason: typeof body.reason === "string" ? body.reason : null,
  }));
}

export interface TransactionsResponse {
  transactions: HistoryTransaction[];
  /** True when the league had more trades than the route's cap. */
  truncated: boolean;
}

/**
 * GET /api/on-the-clock/transactions?league_id= (every completed trade in the
 * league, newest first, shaped for the Trade History tab). The server is the only
 * Sleeper-touching path; the client caches the result for the session.
 */
export function fetchTransactions(leagueId: string): Promise<ApiResult<TransactionsResponse>> {
  const qs = new URLSearchParams({ league_id: leagueId }).toString();
  return request(`/api/on-the-clock/transactions?${qs}`, { method: "GET" }, (body) => ({
    transactions: Array.isArray(body.transactions)
      ? (body.transactions as HistoryTransaction[])
      : [],
    truncated: Boolean(body.truncated),
  }));
}

/** GET /api/on-the-clock/draft?draft_id= (warm read; cold cache warms once server-side) */
export function fetchDraft(draftId: string): Promise<ApiResult<{ cache: ShapedDraftCache }>> {
  const qs = new URLSearchParams({ draft_id: draftId }).toString();
  return request(`/api/on-the-clock/draft?${qs}`, { method: "GET" }, (body) => ({
    cache: body.cache as ShapedDraftCache,
  }));
}

export interface SyncResponse {
  status: SyncStatus;
  cooldownRemainingSeconds: number;
  lastSyncedAt: string | null;
  cache: ShapedDraftCache | null;
  error?: string;
}

/**
 * POST /api/on-the-clock/draft/sync. The route returns HTTP 200 with a status
 * union even when the logical outcome is "cooldown" / "synced-by-other" / a soft
 * "error", so the caller renders from data.status; only 400/403/500/503 surface as
 * ApiResult errors.
 */
export function syncDraft(params: {
  draftId: string;
  leagueId?: string;
  season?: string;
}): Promise<ApiResult<SyncResponse>> {
  const payload: Record<string, string> = { draft_id: params.draftId };
  if (params.leagueId) payload.league_id = params.leagueId;
  if (params.season) payload.season = params.season;
  return request(
    `/api/on-the-clock/draft/sync`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    (body) => ({
      status: (typeof body.status === "string" ? body.status : "error") as SyncStatus,
      cooldownRemainingSeconds: Number(body.cooldownRemainingSeconds ?? 0),
      lastSyncedAt: typeof body.lastSyncedAt === "string" ? body.lastSyncedAt : null,
      cache: (body.cache as ShapedDraftCache | null) ?? null,
      ...(typeof body.error === "string" ? { error: body.error } : {}),
    }),
  );
}
