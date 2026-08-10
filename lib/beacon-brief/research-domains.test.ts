import { describe, expect, it } from "vitest";
import { parseDomainList } from "./settings";
import { isDomainAccessError } from "./ai";

/**
 * Parsing the research search allowlist.
 *
 * This one is worth pinning down because a mistake is silent. The web_search
 * tool takes bare hostnames; a malformed entry does not error, it simply matches
 * nothing, and the search quietly narrows without anything appearing in the logs.
 * The failure looks like the research prompt returning NO RESULTS more often,
 * which reads as "there was nothing to find" rather than "we asked wrong".
 *
 * The other half is the empty case. An empty list must mean "search the whole
 * web", never "search nothing", because clearing the field on the admin Settings
 * page is the documented way to turn the restriction off.
 */

describe("parseDomainList", () => {
  it("splits and trims a comma-separated list", () => {
    expect(parseDomainList("espn.com, nfl.com ,  pff.com")).toEqual([
      "espn.com",
      "nfl.com",
      "pff.com",
    ]);
  });

  it("reduces a pasted URL to its hostname", () => {
    // Pasting a link is the obvious thing to do, so accept it rather than
    // dropping the entry and silently shrinking the allowlist.
    expect(
      parseDomainList(
        "https://www.espn.com/nfl/story/_/id/123, HTTP://NFL.com/",
      ),
    ).toEqual(["espn.com", "nfl.com"]);
  });

  it("keeps subdomains, which are meaningful", () => {
    // sports.yahoo.com is the NFL desk; yahoo.com would open up the whole portal.
    expect(parseDomainList("sports.yahoo.com")).toEqual(["sports.yahoo.com"]);
  });

  it("de-duplicates entries that normalize to the same host", () => {
    expect(parseDomainList("espn.com, www.espn.com, https://espn.com")).toEqual(
      ["espn.com"],
    );
  });

  it("drops junk instead of passing it to the API", () => {
    // No dot, a bare word, a stray comma. Each would match nothing.
    expect(parseDomainList("espn.com, localhost, , nfl, ok.com")).toEqual([
      "espn.com",
      "ok.com",
    ]);
  });

  it("treats an empty or missing value as no restriction", () => {
    // ai.ts omits allowed_domains entirely on an empty array. Returning [] here
    // is what makes clearing the setting mean "search the whole web".
    expect(parseDomainList("")).toEqual([]);
    expect(parseDomainList("   ,  , ")).toEqual([]);
    expect(parseDomainList(null)).toEqual([]);
    expect(parseDomainList(undefined)).toEqual([]);
    expect(parseDomainList(42)).toEqual([]);
  });
});

/**
 * Recognising the rejection that took the whole feature down.
 *
 * Seven of the 22 domains seeded in migration 0186 could not be crawled by
 * Anthropic's search agent. The API does not drop a blocked entry or warn: it
 * 400s the entire request. Every research call failed, the caller returned null,
 * and articles carried on publishing with no research at all while research
 * spend fell to zero. On a cost dashboard that looks exactly like the saving
 * working, which is why it needs to be caught by name and retried rather than
 * left to the generic error path.
 */
describe("isDomainAccessError", () => {
  it("recognises the real rejection text the API returned", () => {
    // Copied verbatim from the live 400 during the 0187 investigation.
    const real =
      '400 {"type":"error","error":{"type":"invalid_request_error",' +
      '"message":"The following domains are not accessible to our user agent: ' +
      "['apnews.com', 'nypost.com', 'nytimes.com', 'reuters.com', " +
      "'sportingnews.com', 'theathletic.com', 'usatoday.com']. Read more: ...\"}}";
    expect(isDomainAccessError(real)).toBe(true);
  });

  it("does not fire on unrelated failures", () => {
    // These must reach the generic error path. Retrying them without domains
    // would burn a second call and still fail.
    for (const other of [
      "429 rate_limit_error",
      "overloaded_error",
      "'claude-haiku-4-5-20251001' does not support programmatic tool calling.",
      "Connection error.",
      "",
    ]) {
      expect(isDomainAccessError(other)).toBe(false);
    }
  });
});
