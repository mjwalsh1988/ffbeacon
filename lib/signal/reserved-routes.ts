// Single source of truth for the top-level route segments that a Signal handle
// must never shadow at the root /{handle} alias (Phase 7).
//
// WHY THIS EXISTS
// Next.js route precedence already guarantees a literal segment (app/players,
// app/rankings, ...) beats the dynamic app/[handle] segment, so a handle can
// never shadow a real route at RUNTIME. This constant guards the two remaining
// risks, both at claim time:
//   1. A user claiming a handle that names a real page (confusing: their profile
//      would live at /u/{handle} while ffbeacon.com/{handle} is the real page).
//   2. The future-route foot-gun: a handle claimed today that a later top-level
//      route would shadow, breaking the /u/{handle} -> /{handle} 301 for them.
//
// This is the canonical list. Migration 0076 mirrors it into
// signal_reserved_handles (the table the 0068 claim-time trigger enforces), and
// scripts/check-reserved-routes.ts fails the build if:
//   - any top-level app/ folder is missing from this constant, OR
//   - any segment here is missing from signal_reserved_handles.
// So adding app/blog/ later cannot ship until 'blog' is added here AND seeded.
//
// Keep this list EXACTLY in sync with the top-level folders under app/ (every
// literal segment folder; dynamic [..], route groups (..), and private _..
// folders are excluded by the guard, not listed here).

export const RESERVED_ROUTE_SEGMENTS = [
  "about",
  "actions",
  "admin",
  "api",
  "auth",
  "author",
  "brief",
  "games",
  "guides",
  "join",
  "leagues",
  // app/llms.txt/route.ts. A folder rather than a file because the route needs a
  // dot in its path, so unlike sitemap.ts and robots.ts it counts as a top-level
  // segment and has to be reserved here.
  "llms.txt",
  "login",
  "my-beacon",
  "players",
  "privacy",
  "rankings",
  "terms",
  "tools",
  "u",
] as const;

const RESERVED_ROUTE_SEGMENT_SET: ReadonlySet<string> = new Set(
  RESERVED_ROUTE_SEGMENTS,
);

/**
 * True when the given (already-normalized, lowercase) handle names a real
 * top-level route segment. Used by the root app/[handle] resolver as in-memory
 * defense in depth so a route-segment-shaped path never attempts a profile
 * load, independent of any stale signal row. Real routes already win at the
 * router level; this covers the case where the catch-all is reached anyway.
 */
export function isReservedRouteSegment(handle: string): boolean {
  return RESERVED_ROUTE_SEGMENT_SET.has(handle);
}
