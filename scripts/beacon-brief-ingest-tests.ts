/**
 * The Beacon Brief ingest unit tests (pure, no DB / no network).
 *
 * Covers the retweet/quote normalization and Discord media ordering that the
 * F2/F3/F4 fixes depend on:
 *   - a resolved retweet promotes the original's full text + carries its media
 *   - an unresolved retweet (referenced tweet missing) keeps the stub text and is
 *     flagged retweet_unresolved so the curator never builds an article from it
 *   - a quote tweet keeps the quoter's own text (not promoted)
 *   - orderMediaForDiscord leads with the right content and reserves a slot for the
 *     referenced context image so it is not crowded out under the cap
 *
 * Run: npm run beacon-brief:tests
 */

import type { XTimelineResponse } from "../lib/x";
import { normalizeTimeline } from "../lib/beacon-brief/ingest-x";
import { orderMediaForDiscord } from "../lib/beacon-brief/worker";
import type { BeaconBriefMedia } from "../lib/beacon-brief/types";

type Source = Parameters<typeof normalizeTimeline>[1];
const SOURCE = {
  id: "src-1",
  handle: "TestSource",
  external_account_id: "999",
} as unknown as Source;

let failures = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    console.log("ok   -", name);
  } else {
    console.error("FAIL -", name);
    failures += 1;
  }
}
function eq(name: string, actual: unknown, expected: unknown): void {
  check(
    `${name} (got ${JSON.stringify(actual)})`,
    JSON.stringify(actual) === JSON.stringify(expected),
  );
}

const photo = (url: string): BeaconBriefMedia => ({ type: "photo", url });

// 1. Resolved retweet: full text promoted, media + author carried, not flagged.
{
  const resp: XTimelineResponse = {
    data: [
      {
        id: "rt1",
        text: "RT @breaker: Big trade incoming, full details...",
        edit_history_tweet_ids: ["rt1"],
        author_id: "999",
        referenced_tweets: [{ type: "retweeted", id: "orig1" }],
      },
    ],
    includes: {
      tweets: [
        {
          id: "orig1",
          text: "Big trade incoming, full details with the numbers here",
          author_id: "100",
          attachments: { media_keys: ["m1"] },
        },
      ],
      users: [
        { id: "999", username: "TestSource", name: "Test Source" },
        { id: "100", username: "breaker", name: "The Breaker" },
      ],
      media: [
        { media_key: "m1", type: "photo", url: "https://pbs.twimg.com/m1.jpg" },
      ],
    },
  };
  const [item] = normalizeTimeline(resp, SOURCE);
  eq(
    "resolved retweet promotes original text",
    item.text,
    "Big trade incoming, full details with the numbers here",
  );
  eq("resolved retweet not flagged", item.retweet_unresolved, false);
  eq("resolved retweet keeps original author", item.retweeted?.author_handle, "breaker");
  eq(
    "resolved retweet carries original media",
    item.retweeted?.media?.[0]?.url,
    "https://pbs.twimg.com/m1.jpg",
  );
}

// 2. Unresolved retweet: referenced tweet missing -> keep stub, flag it.
{
  const resp: XTimelineResponse = {
    data: [
      {
        id: "rt2",
        text: "RT @breaker: Partial stub text that is cut off...",
        edit_history_tweet_ids: ["rt2"],
        author_id: "999",
        referenced_tweets: [{ type: "retweeted", id: "missing1" }],
      },
    ],
    includes: {
      users: [{ id: "999", username: "TestSource", name: "Test Source" }],
    },
  };
  const [item] = normalizeTimeline(resp, SOURCE);
  eq("unresolved retweet flagged", item.retweet_unresolved, true);
  eq(
    "unresolved retweet keeps stub text",
    item.text,
    "RT @breaker: Partial stub text that is cut off...",
  );
  eq("unresolved retweet has no retweeted block", item.retweeted, null);
}

// 3. Quote tweet: quoter's own text is NOT promoted; quoted carried as context.
{
  const resp: XTimelineResponse = {
    data: [
      {
        id: "q1",
        text: "My take on this:",
        edit_history_tweet_ids: ["q1"],
        author_id: "999",
        referenced_tweets: [{ type: "quoted", id: "orig2" }],
      },
    ],
    includes: {
      tweets: [{ id: "orig2", text: "Original quoted content", author_id: "200" }],
      users: [
        { id: "999", username: "TestSource", name: "Test Source" },
        { id: "200", username: "someone", name: "Someone" },
      ],
    },
  };
  const [item] = normalizeTimeline(resp, SOURCE);
  eq("quote keeps quoter text", item.text, "My take on this:");
  eq("quote not flagged", item.retweet_unresolved, false);
  eq("quote carries quoted text", item.quoted?.text, "Original quoted content");
}

// 4. orderMediaForDiscord: content leads, context slot reserved, deduped.
{
  eq(
    "retweet uses the retweeted media",
    orderMediaForDiscord([], [], [photo("a")], true, 4).map((m) => m.url),
    ["a"],
  );

  const quoteHeavy = orderMediaForDiscord(
    [photo("o1"), photo("o2"), photo("o3"), photo("o4")],
    [photo("q1")],
    [],
    false,
    4,
  );
  check(
    "quote context image survives the 4-cap",
    quoteHeavy
      .slice(0, 4)
      .map((m) => m.url)
      .includes("q1"),
  );

  eq(
    "media deduped by URL",
    orderMediaForDiscord([photo("x")], [photo("x")], [], false, 4).map(
      (m) => m.url,
    ),
    ["x"],
  );
}

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nall beacon-brief ingest tests passed");
