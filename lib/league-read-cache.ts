import { cache } from "react";

/**
 * A short memory of the database reads a signed-out league page makes.
 *
 * WHY THIS EXISTS
 *   A league page renders from scratch on every request, and a synced league
 *   costs about fifty reads each time. Nearly all league traffic is signed-out,
 *   and on 2026-11-27 one crawler loaded a single league 3,300 times in 25
 *   minutes: 3,300 times the same fifty answers. With this, the first view in a
 *   five minute window asks the database and the rest are answered from memory.
 *
 * WHAT IS REMEMBERED
 *   The raw answer to a GET against the REST API, keyed on the full request URL
 *   and the headers that change the answer. Nothing is parsed or reshaped, so a
 *   hit is byte for byte what the database said, and no loader had to change.
 *   Only a 200 is kept. A failed read is never remembered (CLAUDE.md: a failure
 *   is not an empty answer).
 *
 * WHO GETS IT
 *   Only a request the league page budget counted as anonymous
 *   (components/league-view-refused.tsx turns it on), and only a read sent with
 *   the publishable key, which is the anonymous role under RLS. A read that
 *   carries a member's token is never stored and never served from here, so one
 *   reader's rows cannot reach another. Members always read live.
 *
 * WHERE IT LIVES
 *   In this module, in the memory of one server instance. Not the Next data
 *   cache: that bills every write, and a crawl across many leagues is all
 *   writes. Instances are long lived and shared between concurrent requests, so
 *   a burst on one league lands on a handful of them. A cold instance starts
 *   empty, which costs one normal page load.
 *
 * STALENESS, AND WHAT VOIDS A REMEMBERED ANSWER
 *   A signed-out reader can see a league up to LEAGUE_READ_TTL_MS behind, and
 *   never further behind than the league's last change that this instance
 *   knows of. Each league has a "changed at" time, and an answer that was
 *   ASKED FOR before that time is a miss for a reader of that league. Three
 *   things move the time forward, in any context (a render, a route handler, a
 *   member's view, a script):
 *   - a sync that just wrote the league (noteLeagueSync from pulseLeagueCore),
 *   - the last_pulsed_at on the league row, which the core reads live on every
 *     view, so a sync done by ANOTHER instance or the Refresh button counts too,
 *   - a derived pass finishing (noteLeagueDerived), so a section that read the
 *     model tables while the first compute was still running is not remembered
 *     as empty.
 *   The check is on the reader's league, not on who stored the answer, and it
 *   does not depend on whether the sync finished before or after the budget
 *   turned the cache on.
 *
 * Identical reads that are in flight at the same moment share one request, so
 * a burst of concurrent loads of one league is one set of queries, not many.
 */

export const LEAGUE_READ_TTL_MS = 5 * 60 * 1000;
/** A single answer larger than this is passed through and not kept. */
const MAX_ENTRY_CHARS = 2_000_000;
/** Total characters held. Oldest entries go first once this is passed. */
const MAX_TOTAL_CHARS = 48_000_000;
/** Expired entries are swept out every this many stores. */
const SWEEP_EVERY = 500;
/** Leagues tracked before the whole module state is dropped and rebuilt. */
const MAX_TRACKED_LEAGUES = 5_000;

export type LeagueReadMode =
  /** Not a counted anonymous league view. Every read is live. */
  | "off"
  /** Serve from memory when fresh, otherwise read and remember. */
  | "use";

export type LeagueReadState = { mode: LeagueReadMode; league: string | null };

/**
 * One state object per render. Outside a render (a script, a cron body, a
 * route handler) React's cache() is a plain call, so every lookup gets a fresh
 * "off" and no read is ever served from memory there.
 */
const requestState = cache((): LeagueReadState => ({ mode: "off", league: null }));

type Entry = {
  body: string;
  headers: [string, string][];
  /** When the read was sent, not when it came back. */
  askedAt: number;
  expiresAt: number;
};

const store = new Map<string, Entry>();
const inFlight = new Map<string, { askedAt: number; read: Promise<Entry | null> }>();
let totalChars = 0;
let storesSinceSweep = 0;

/** Sleeper league id to the time its rows last changed, as far as we know. */
const changedAt = new Map<string, number>();
/** Sleeper league id to the time of its last sync, as far as we know. */
const syncedAt = new Map<string, number>();
/** League row id to Sleeper league id, learned from the core on every view. */
const leagueOfRow = new Map<string, string>();

/** Headers describing an encoding the stored text no longer has. */
const DROPPED_HEADERS = new Set(["content-encoding", "content-length", "transfer-encoding"]);

function drop(key: string): void {
  const entry = store.get(key);
  if (!entry) return;
  store.delete(key);
  totalChars -= entry.body.length;
}

function put(key: string, entry: Entry, now: number): void {
  drop(key);
  store.set(key, entry);
  totalChars += entry.body.length;
  storesSinceSweep += 1;
  if (storesSinceSweep >= SWEEP_EVERY) {
    storesSinceSweep = 0;
    for (const [k, e] of store) if (e.expiresAt <= now) drop(k);
  }
  for (const oldestKey of store.keys()) {
    if (totalChars <= MAX_TOTAL_CHARS || oldestKey === key) break;
    drop(oldestKey);
  }
}

function toResponse(entry: Entry): Response {
  return new Response(entry.body, { status: 200, statusText: "OK", headers: entry.headers });
}

function raise(map: Map<string, number>, league: string, at: number): void {
  if ((map.get(league) ?? 0) < at) map.set(league, at);
}

/**
 * The league page budget calls this once it has counted an anonymous view of
 * this league.
 */
export function allowLeagueReadCache(sleeperLeagueId: string): void {
  const state = requestState();
  state.mode = "use";
  state.league = sleeperLeagueId;
}

export function leagueReadMode(): LeagueReadMode {
  return requestState().mode;
}

/**
 * The core read or wrote this league. `at` is when its rows last changed: now
 * for a sync that just finished, or the row's last_pulsed_at for a stored copy.
 * Safe to call anywhere, on every view.
 */
export function noteLeagueSync(sleeperLeagueId: string, leagueRowId: string, at: number): void {
  if (!Number.isFinite(at)) return;
  if (leagueOfRow.size >= MAX_TRACKED_LEAGUES && !leagueOfRow.has(leagueRowId)) {
    // Forgetting when a league changed would let an old answer look current,
    // so the answers go with it.
    resetLeagueReadCache();
  }
  leagueOfRow.set(leagueRowId, sleeperLeagueId);
  raise(syncedAt, sleeperLeagueId, at);
  raise(changedAt, sleeperLeagueId, at);
}

/** A derived pass for this league just finished and may have written models. */
export function noteLeagueDerived(leagueRowId: string, at: number = Date.now()): void {
  const league = leagueOfRow.get(leagueRowId);
  if (league) raise(changedAt, league, at);
}

/** When this league was last synced, as far as this instance knows. 0 if never seen. */
export function leagueSyncedAt(leagueRowId: string): number {
  const league = leagueOfRow.get(leagueRowId);
  return league ? (syncedAt.get(league) ?? 0) : 0;
}

type FetchLike = typeof fetch;

/**
 * Wrap a fetch so anonymous league views answer repeat reads from memory.
 * `state` and `now` are injectable for tests; production reads the per-render
 * state and the clock.
 */
export function createLeagueReadCachingFetch(
  baseFetch: FetchLike,
  state: () => LeagueReadState = requestState,
  now: () => number = Date.now,
): FetchLike {
  return async function leagueReadCachingFetch(input, init) {
    const current = state();
    if (current.mode === "off") return baseFetch(input, init);
    if (typeof input !== "string" && !(input instanceof URL)) return baseFetch(input, init);
    if ((init?.method ?? "GET").toUpperCase() !== "GET") return baseFetch(input, init);

    const url = String(input);
    // Table and view reads only. An rpc can be volatile, and auth or storage
    // calls are not league data.
    if (!url.includes("/rest/v1/") || url.includes("/rest/v1/rpc/")) {
      return baseFetch(input, init);
    }

    const headers = new Headers(init?.headers);
    const anonymousKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    // Only the anonymous role. A member's token means the answer is theirs.
    if (!anonymousKey || headers.get("authorization") !== `Bearer ${anonymousKey}`) {
      return baseFetch(input, init);
    }

    const key = [
      url,
      headers.get("accept") ?? "",
      headers.get("prefer") ?? "",
      headers.get("range") ?? "",
      headers.get("accept-profile") ?? "",
    ].join("\n");

    // Looked up at use, not captured: the league can change while this request
    // is still rendering.
    const voidBefore = () => (current.league ? (changedAt.get(current.league) ?? 0) : 0);

    const hit = store.get(key);
    if (hit && hit.expiresAt > now() && hit.askedAt > voidBefore()) return toResponse(hit);
    const pending = inFlight.get(key);
    if (pending && pending.askedAt > voidBefore()) {
      const shared = await pending.read.catch(() => null);
      if (shared && shared.askedAt > voidBefore()) return toResponse(shared);
      // The shared read failed, was not a 200, or the league changed while it
      // was out. Ask for ourselves.
    }

    const askedAt = now();
    let passthrough: Response | null = null;
    const read = (async (): Promise<Entry | null> => {
      const response = await baseFetch(input, init);
      if (response.status !== 200) {
        passthrough = response;
        return null;
      }
      const body = await response.text();
      const entry: Entry = {
        body,
        headers: [...response.headers].filter(([name]) => !DROPPED_HEADERS.has(name)),
        askedAt,
        expiresAt: askedAt + LEAGUE_READ_TTL_MS,
      };
      if (body.length <= MAX_ENTRY_CHARS) put(key, entry, now());
      return entry;
    })();
    const flight = { askedAt, read };
    inFlight.set(key, flight);
    try {
      const entry = await read;
      // The caller gets its own answer even when the league changed meanwhile:
      // it is what a live read would have returned. Later readers will miss.
      if (entry) return toResponse(entry);
      return passthrough as unknown as Response;
    } finally {
      if (inFlight.get(key) === flight) inFlight.delete(key);
    }
  };
}

/** Empty the module state. Also the test seam. */
export function resetLeagueReadCache(): void {
  store.clear();
  inFlight.clear();
  changedAt.clear();
  syncedAt.clear();
  leagueOfRow.clear();
  totalChars = 0;
  storesSinceSweep = 0;
}
