import { describe, expect, it } from "vitest";
import {
  chooseCardMediaIndex,
  discordSnowflakeTimeMs,
  earlierEditIds,
  orderForThreads,
  ownPostIds,
  referencedPostIds,
  repliedToIds,
  safeCursor,
} from "./thread";

type Item = { source_external_id: string; raw: unknown };

function post(id: string, raw: Record<string, unknown> = {}): Item {
  return { source_external_id: id, raw: { id, ...raw } };
}

describe("referencedPostIds", () => {
  it("reads quoted, replied_to and retweeted ids once each", () => {
    expect(
      referencedPostIds({
        referenced_tweets: [
          { type: "quoted", id: "10" },
          { type: "replied_to", id: "11" },
          { type: "retweeted", id: "12" },
          { type: "quoted", id: "10" },
        ],
      }),
    ).toEqual(["10", "11", "12"]);
  });

  it("ignores unknown types, missing ids and unreadable input", () => {
    expect(referencedPostIds({ referenced_tweets: [{ type: "other", id: "1" }, { type: "quoted" }] })).toEqual([]);
    expect(referencedPostIds(null)).toEqual([]);
    expect(referencedPostIds("nope")).toEqual([]);
    expect(referencedPostIds({ referenced_tweets: "x" })).toEqual([]);
  });
});

describe("earlierEditIds and ownPostIds", () => {
  it("lists earlier versions newest first, without the post itself", () => {
    const raw = { edit_history_tweet_ids: ["1", "2", "3"] };
    expect(earlierEditIds(raw, "3")).toEqual(["2", "1"]);
    expect(ownPostIds({ source_external_id: "3", raw })).toEqual(["3", "2", "1"]);
  });

  it("is empty for a post that was never edited", () => {
    expect(earlierEditIds({ edit_history_tweet_ids: ["5"] }, "5")).toEqual([]);
    expect(earlierEditIds({}, "5")).toEqual([]);
  });
});

describe("orderForThreads", () => {
  it("puts an edited post ahead of the quotes of its first version (the Brissett case)", () => {
    // Times: the quotes went out at 19:44 and 19:47, the edited trade post at
    // 19:56 (an edit takes the time of the edit). The quotes point at the
    // FIRST version, 2118066466520178866.
    const quote1 = post("2118066964358635594", { referenced_tweets: [{ type: "quoted", id: "2118066466520178866" }] });
    const quote2 = post("2118067640464003575", { referenced_tweets: [{ type: "quoted", id: "2118066466520178866" }] });
    const edited = post("2118069920952885484", {
      edit_history_tweet_ids: ["2118066466520178866", "2118069920952885484"],
    });
    const later = post("2118081168159699237");
    const ordered = orderForThreads([quote1, quote2, edited, later]);
    expect(ordered.map((i) => i.source_external_id)).toEqual([
      "2118069920952885484",
      "2118066964358635594",
      "2118067640464003575",
      "2118081168159699237",
    ]);
  });

  it("keeps time order when nothing links, and never drops or duplicates", () => {
    const items = [post("1"), post("2"), post("3")];
    expect(orderForThreads(items)).toEqual(items);
    const linked = [post("1", { referenced_tweets: [{ type: "replied_to", id: "3" }] }), post("2"), post("3")];
    const out = orderForThreads(linked);
    expect(out).toHaveLength(3);
    expect(new Set(out.map((i) => i.source_external_id))).toEqual(new Set(["1", "2", "3"]));
    expect(out.map((i) => i.source_external_id)).toEqual(["3", "1", "2"]);
  });

  it("survives a cycle", () => {
    const a = post("1", { referenced_tweets: [{ type: "quoted", id: "2" }] });
    const b = post("2", { referenced_tweets: [{ type: "quoted", id: "1" }] });
    const out = orderForThreads([a, b]);
    expect(out).toHaveLength(2);
    expect(new Set(out)).toEqual(new Set([a, b]));
  });

  it("ignores a post that references itself", () => {
    const a = post("1", { referenced_tweets: [{ type: "quoted", id: "1" }] });
    expect(orderForThreads([a])).toEqual([a]);
  });
});

describe("safeCursor", () => {
  const chron = [post("1"), post("2"), post("3"), post("4")];

  it("advances only past a fully processed prefix", () => {
    expect(safeCursor(chron, new Set())).toBeNull();
    expect(safeCursor(chron, new Set(["2", "3"]))).toBeNull();
    expect(safeCursor(chron, new Set(["1", "3"]))).toBe("1");
    expect(safeCursor(chron, new Set(["1", "2", "3"]))).toBe("3");
    expect(safeCursor(chron, new Set(["1", "2", "3", "4"]))).toBe("4");
  });
});

describe("discordSnowflakeTimeMs", () => {
  it("reads the creation time out of a Discord id", () => {
    // 1567642648297345028 was posted on 2026-11-04 at 20:52:13 UTC.
    const ms = discordSnowflakeTimeMs("1567642648297345028");
    expect(ms).not.toBeNull();
    expect(new Date(ms as number).toISOString().slice(0, 16)).toBe("2026-11-04T20:52");
  });

  it("is null for anything that is not a snowflake", () => {
    expect(discordSnowflakeTimeMs(null)).toBeNull();
    expect(discordSnowflakeTimeMs("")).toBeNull();
    expect(discordSnowflakeTimeMs("abc")).toBeNull();
    expect(discordSnowflakeTimeMs("123")).toBeNull();
  });
});

describe("chooseCardMediaIndex", () => {
  const img = (url: string) => [{ type: "photo" as const, url }];
  const none = { media: [], quoted: null, retweeted: null };

  it("prefers the first post with images of its own over a quoted image", () => {
    expect(
      chooseCardMediaIndex([
        { media: [], quoted: { author_handle: "a", text: "t", media: img("q") }, retweeted: null },
        { media: img("own"), quoted: null, retweeted: null },
      ]),
    ).toBe(1);
  });

  it("keeps the story's own images when it has them", () => {
    expect(chooseCardMediaIndex([{ media: img("lead"), quoted: null, retweeted: null }, { media: img("b"), quoted: null, retweeted: null }])).toBe(0);
  });

  it("treats a retweet's images as its own", () => {
    expect(
      chooseCardMediaIndex([none, { media: [], quoted: null, retweeted: { author_handle: "a", text: "t", media: img("rt") } }]),
    ).toBe(1);
  });

  it("falls back to a quoted image, and to null when there is none", () => {
    expect(chooseCardMediaIndex([none, { media: [], quoted: { author_handle: "a", text: "t", media: img("q") }, retweeted: null }])).toBe(1);
    expect(chooseCardMediaIndex([none, none])).toBeNull();
    expect(chooseCardMediaIndex([])).toBeNull();
  });
});

describe("repliedToIds", () => {
  it("reads only reply links", () => {
    expect(
      repliedToIds({
        referenced_tweets: [
          { type: "quoted", id: "1" },
          { type: "replied_to", id: "2" },
        ],
      }),
    ).toEqual(["2"]);
    expect(repliedToIds(null)).toEqual([]);
  });
});
