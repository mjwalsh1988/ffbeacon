import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizeGiphySearch } from "@/lib/signal/giphy";

/**
 * GET /api/signal/gif/search?q=...&offset=0
 *
 * Server-side proxy for GIPHY GIF search. The GIPHY_API_KEY lives only here
 * (server-side); it is never forwarded to the client and never appears in a client
 * bundle. The raw GIPHY payload is normalized down to a tiny shape before it is
 * returned (see lib/signal/giphy.ts), so the response stays small no matter how
 * many renditions GIPHY sends.
 *
 * Hardening:
 *   - same-origin only (x-requested-with header), matching the other Signal routes.
 *   - session required: only signed-in users can search (the GIF picker only renders
 *     in authenticated composers).
 *   - rating is LOCKED to "g" server-side. GIPHY's default rating is UNFILTERED, so
 *     this parameter is mandatory and is never read from the client.
 *   - light best-effort per-user throttle (in addition to the client debounce).
 *   - offset paging only, and search-on-query only by design: we do NOT call
 *     GIPHY's trending endpoint. Search runs only when there is a query.
 */

export const runtime = "nodejs";

const GIPHY_SEARCH_URL = "https://api.giphy.com/v1/gifs/search";
const LIMIT = 24;
const MAX_OFFSET = 200;
const MAX_QUERY_LEN = 100;

// Best-effort per-user throttle. Serverless instances do not share memory, so this
// is a per-instance backstop layered on top of the client-side debounce; it is not
// a hard guarantee. Min interval between searches + a rolling per-minute cap.
const MIN_INTERVAL_MS = 600;
const WINDOW_MS = 60 * 1000;
const WINDOW_MAX = 40;
const hits = new Map<string, number[]>();

function throttled(userId: string): boolean {
  const now = Date.now();
  const times = (hits.get(userId) ?? []).filter((t) => t > now - WINDOW_MS);
  if (times.length > 0 && now - times[times.length - 1] < MIN_INTERVAL_MS) {
    // Re-store the pruned list so a since-idle user does not leave stale entries.
    if (times.length === 0) hits.delete(userId);
    else hits.set(userId, times);
    return true;
  }
  if (times.length >= WINDOW_MAX) {
    hits.set(userId, times);
    return true;
  }
  times.push(now);
  hits.set(userId, times);
  return false;
}

function isSameOrigin(req: Request): boolean {
  return req.headers.get("x-requested-with") === "ff-beacon";
}

export async function GET(req: Request) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 403 });
  }

  const apiKey = process.env.GIPHY_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GIF search is unavailable right now." },
      { status: 503 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to search GIFs." }, { status: 401 });
  }

  if (throttled(user.id)) {
    return NextResponse.json(
      { error: "Slow down a moment, then search again." },
      { status: 429 },
    );
  }

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim().slice(0, MAX_QUERY_LEN);
  if (q.length === 0) {
    return NextResponse.json({ results: [], hasMore: false });
  }

  let offset = Number(searchParams.get("offset") ?? 0);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  offset = Math.min(Math.floor(offset), MAX_OFFSET);

  const url = new URL(GIPHY_SEARCH_URL);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", String(LIMIT));
  url.searchParams.set("offset", String(offset));
  // Rating is locked server-side. Never accept this from the client.
  url.searchParams.set("rating", "g");
  url.searchParams.set("lang", "en");

  let payload: unknown;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: "GIF search is unavailable right now." },
        { status: 502 },
      );
    }
    payload = await res.json();
  } catch {
    return NextResponse.json(
      { error: "GIF search timed out. Please try again." },
      { status: 504 },
    );
  }

  const { results, hasMore } = normalizeGiphySearch(payload);
  // Stop paging once the next page would exceed the offset cap (the client clamps
  // to the same page otherwise).
  return NextResponse.json({ results, hasMore: hasMore && offset < MAX_OFFSET });
}
