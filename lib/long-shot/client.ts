/**
 * Browser-side fetch wrappers for the Long Shot routes (plan 17 and 18.2),
 * the Signal Scout client pattern: every call carries the same-origin header
 * and cache: "no-store", parses JSON defensively, and maps { error: code }
 * to a typed result. Only TYPE imports from server modules, so no server
 * code reaches the client bundle.
 */

import type { SearchOutcome, SearchPlayerResult } from "@/components/player-guess-combobox";
import type { LongShotErrorCode } from "./errors";
import type { Board, LeaderboardView } from "./leaderboards";
import type { AttemptDto, CompletedDto, Mode, PageStateDto, PromptDto, ResultDto } from "./types";

export const LONG_SHOT_REQUEST_HEADER = { "x-requested-with": "ff-beacon" } as const;

export type ClientErrorCode = LongShotErrorCode | "network";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; code: ClientErrorCode };

/** Copy for every client error state (plan 18.2). No raw error text is ever shown. */
export const CLIENT_ERROR_COPY: Partial<Record<ClientErrorCode, string>> = {
  rate_limited: "Too many requests. Your clock is still running; try again.",
  network: "Could not reach the server. Press Answer again.",
  attempt_closed:
    "This attempt was closed when the day ended. Your answered prompts are kept as an abandoned day.",
  no_puzzle:
    "Film Room has no past puzzle yet. Play today's Hurry-Up first; Film Room opens on today's puzzle when it is done.",
  puzzle_unavailable: "Today's puzzle could not be built. Try again in a few minutes.",
  game_disabled: "Long Shot is paused. Check back soon.",
};

export const GENERIC_ERROR_COPY = "Something went wrong. Reload the page to continue; your attempt is saved.";

const KNOWN = new Set<string>([
  "invalid_request",
  "not_film_room",
  "login_required",
  "forbidden",
  "film_room_disabled",
  "not_found",
  "attempt_active",
  "attempt_closed",
  "stale_prompt",
  "no_puzzle",
  "rate_limited",
  "server_error",
  "game_disabled",
  "puzzle_unavailable",
  "leaderboards_disabled",
]);

async function parseJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const body = await res.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function request<T>(
  input: string,
  init: RequestInit,
  shape: (body: Record<string, unknown>) => T | null,
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(input, {
      ...init,
      headers: { ...LONG_SHOT_REQUEST_HEADER, ...(init.headers ?? {}) },
      cache: "no-store",
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return { ok: false, status: 0, code: "network" };
  }
  const body = await parseJson(res);
  if (!res.ok) {
    const raw = typeof body.error === "string" ? body.error : "";
    return { ok: false, status: res.status, code: KNOWN.has(raw) ? (raw as LongShotErrorCode) : "server_error" };
  }
  const data = shape(body);
  // A 2xx with a malformed body is the generic error, never a crash.
  if (data === null) return { ok: false, status: res.status, code: "server_error" };
  return { ok: true, data };
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export type StartOrNext = PromptDto | CompletedDto | { kind: "existing"; attempt: AttemptDto };

function startOrNext(body: Record<string, unknown>): StartOrNext | null {
  const r = body.result as { kind?: string } | undefined;
  return r && (r.kind === "prompt" || r.kind === "completed" || r.kind === "existing") ? (r as StartOrNext) : null;
}

function pageState(body: Record<string, unknown>): PageStateDto | null {
  const s = body.state as PageStateDto | undefined;
  return s && typeof s.gameDate === "string" ? s : null;
}

export function fetchState(): Promise<ApiResult<PageStateDto>> {
  return request("/api/games/long-shot/state", { method: "GET" }, pageState);
}

export function startAttempt(mode: Mode): Promise<ApiResult<StartOrNext>> {
  return request("/api/games/long-shot/attempt", json({ mode }), startOrNext);
}

export function nextPrompt(attemptId: string): Promise<ApiResult<StartOrNext>> {
  return request(`/api/games/long-shot/attempt/${encodeURIComponent(attemptId)}/next`, { method: "POST" }, startOrNext);
}

export function endPractice(attemptId: string): Promise<ApiResult<PageStateDto>> {
  return request(`/api/games/long-shot/attempt/${encodeURIComponent(attemptId)}/end`, { method: "POST" }, pageState);
}

export function submitAnswer(
  attemptId: string,
  body: { position: number; playerId: string | null; timedOut: boolean; skipped: boolean },
): Promise<ApiResult<ResultDto>> {
  return request(
    `/api/games/long-shot/attempt/${encodeURIComponent(attemptId)}/answer`,
    json(body),
    (b) => {
      const r = b.result as ResultDto | undefined;
      return r && typeof r.position === "number" ? r : null;
    },
  );
}

/** The combobox's search function for Long Shot. */
export async function searchPlayers(q: string, signal: AbortSignal): Promise<SearchOutcome> {
  const res = await request(
    `/api/games/long-shot/search?${new URLSearchParams({ q }).toString()}`,
    { method: "GET", signal },
    (b) => ({ results: Array.isArray(b.results) ? (b.results as SearchPlayerResult[]) : [] }),
  );
  return res.ok ? { ok: true, results: res.data.results } : { ok: false, code: res.code };
}

export function fetchLeaderboard(
  board: Board,
  page: number,
  date?: string,
): Promise<ApiResult<LeaderboardView>> {
  const qs = new URLSearchParams({ board, page: String(page), ...(date ? { date } : {}) }).toString();
  return request(`/api/games/long-shot/leaderboards?${qs}`, { method: "GET" }, (b) => {
    const v = b.view as LeaderboardView | undefined;
    return v && Array.isArray(v.rows) ? v : null;
  });
}
