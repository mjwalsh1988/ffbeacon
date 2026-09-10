/**
 * The middleware session refresh.
 *
 * Two things are worth a test here and neither is obvious from reading the
 * file.
 *
 * 1. It must ask for CLAIMS, not for the user. `getUser()` is a network round
 *    trip to the auth server on every matched request, measured at 70 ms, in
 *    front of routing, for every signed-in reader. `getClaims()` verifies the
 *    token's signature locally against the project's published ES256 public key
 *    and only reaches the network when it cannot (an HS256 token, no key id, no
 *    WebCrypto), in which case auth-js calls getUser itself. A future edit that
 *    "simplifies" this back to getUser would put the round trip back with
 *    nothing failing.
 *
 * 2. The matcher must keep skipping the routes that never read a session, and
 *    must keep running on the ones that do. That regex is one long negative
 *    lookahead and it is easy to break by adding an alternative in the wrong
 *    place.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const getClaims = vi.fn(async () => ({ data: null, error: null }));
const getUser = vi.fn(async () => ({ data: { user: null }, error: null }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({ auth: { getClaims, getUser } })),
}));

import { updateSession } from "@/lib/supabase/middleware";
import { config } from "@/middleware";

function request(pathname: string) {
  return {
    cookies: { getAll: () => [], set: () => {} },
    nextUrl: { pathname },
  } as never;
}

describe("updateSession", () => {
  beforeEach(() => {
    getClaims.mockClear();
    getUser.mockClear();
  });

  it("verifies the token locally instead of asking the auth server", async () => {
    await updateSession(request("/leagues/123"));

    expect(getClaims).toHaveBeenCalledTimes(1);
    // The one that costs a round trip. auth-js may still call it internally as
    // its own fallback for a token it cannot verify locally, but this file must
    // never call it directly.
    expect(getUser).not.toHaveBeenCalled();
  });
});

describe("the middleware matcher", () => {
  const matcher = new RegExp(`^${config.matcher[0]}$`);

  it("runs on every route that can carry a session", () => {
    for (const path of [
      "/",
      "/login",
      "/my-beacon",
      "/leagues/123",
      "/brief/some-article",
      "/tools/faab",
      "/api/search",
    ]) {
      expect(matcher.test(path), `expected middleware to run on ${path}`).toBe(
        true,
      );
    }
  });

  it("skips the routes that never read one", () => {
    for (const path of [
      // Authenticates with an HMAC. Kept out so a forged POST cannot force an
      // auth request before the signature check runs.
      "/api/donate/webhook",
      // CRON_SECRET.
      "/api/cron/league-sync-worker",
      // Renders from an id in the path, through the service-role client.
      "/api/og/league/abc",
      "/api/og/trade/abc",
      // Crawler and machine-readable files.
      "/sitemap.xml",
      "/sitemaps/players.xml",
      "/brief/rss.xml",
      "/llms.txt",
      "/llms-full.txt",
      // Static assets.
      "/favicon.ico",
      "/img/ff-beacon-logo.png",
    ]) {
      expect(matcher.test(path), `expected middleware to skip ${path}`).toBe(
        false,
      );
    }
  });

  it("still runs on the one OG route that reads the session", () => {
    // app/api/og/breakdown/[a]/[b]/route.tsx builds the cookie-bound client and
    // resolves the reader's format and source from the session, unlike its nine
    // siblings which use the service-role client. Skipping the refresh there
    // would silently drop a signed-in reader's preferences on an expiring
    // token. If that route ever moves to the admin client, delete this test and
    // the lookahead in the matcher together.
    expect(matcher.test("/api/og/breakdown/josh-allen/james-cook")).toBe(true);
  });

  it("anchors every exclusion at a path boundary", () => {
    // Without the anchors, a path that merely STARTS with one of these literals
    // is excluded too. That is inert while nothing is routed under those
    // prefixes, and a silent hole the day something is.
    for (const path of [
      "/sitemap.xml.bak",
      "/llms.txt.php",
      "/llms-full.txt.php",
      "/llms-fullx.txt",
      "/brief/rss.xmlx",
      "/api/ogsomething",
      "/api/cronx",
      "/api/donate/webhookx",
    ]) {
      expect(
        matcher.test(path),
        `${path} is not an excluded route and middleware must still run on it`,
      ).toBe(true);
    }
  });
});
