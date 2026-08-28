import { describe, expect, it } from "vitest";
import { buildPollMessage, discordTally, discordVoteRows, pollCloseStatus } from "./discord";
import type { WyrAsset, WyrRound } from "./types";

/** Discord's own caps. A message past either of these is rejected outright. */
const POLL_ANSWER_MAX = 55;
const MESSAGE_CONTENT_MAX = 2000;

function asset(name: string, over: Partial<WyrAsset> = {}): WyrAsset {
  return {
    key: "a-0",
    kind: "player",
    name,
    detail: "WR, CIN",
    sleeperId: "1234",
    round: null,
    pickSeason: null,
    pickSlot: null,
    startupPick: null,
    ...over,
  };
}

function round(over: Partial<WyrRound> = {}): WyrRound {
  return {
    tradeId: "11111111-1111-4111-8111-111111111111",
    leagueName: "The Dynasty League",
    season: 2026,
    week: 3,
    derivedLabel: "Dynasty PPR Superflex TE Premium",
    formatShort: "Dynasty 12T SF PPR TEP, start 9",
    formatTags: [],
    scoringTags: [],
    kind: "regular",
    startupSeason: null,
    startupTimingLabel: null,
    tradedAt: "2026-09-20T15:00:00Z",
    sides: {
      a: [asset("Ja'Marr Chase")],
      b: [asset("Bijan Robinson", { key: "b-0", detail: "RB, ATL" })],
    },
    ...over,
  };
}

const OPTS = { siteUrl: "https://ffbeacon.com", mentionRoleIds: [] as string[] };

/**
 * buildPollMessage returns null when a side cannot be named inside Discord's 55
 * characters. Every case below is one that fits, so this asserts that and hands
 * back a non-null message; the refusal has its own test.
 */
function mustBuild(
  ...args: Parameters<typeof buildPollMessage>
): NonNullable<ReturnType<typeof buildPollMessage>> {
  const msg = buildPollMessage(...args);
  if (!msg) throw new Error("expected buildPollMessage to produce a message");
  return msg;
}

/** A big but postable trade: enough to exercise the body, not enough to refuse. */
function busyRound() {
  return round({
    sides: {
      a: [asset("Ja'Marr Chase"), asset("Bijan Robinson", { key: "a-1" })],
      b: [
        asset("Puka Nacua", { key: "b-0" }),
        asset("Drake London", { key: "b-1" }),
        asset("2027 1st", {
          key: "b-2",
          kind: "pick",
          detail: "Draft pick (early)",
          sleeperId: null,
          round: 1,
          pickSeason: 2027,
          pickSlot: "early",
        }),
      ],
    },
  });
}

describe("buildPollMessage", () => {
  it("names the league and its format, and nobody else", () => {
    const msg = mustBuild(round(), OPTS);
    expect(msg.content).toContain("The Dynasty League");
    expect(msg.content).toContain("Dynasty PPR Superflex TE Premium");
    expect(msg.content).toContain("Team A receives");
    expect(msg.content).toContain("Team B receives");
    expect(msg.content).toContain("Ja'Marr Chase");
    expect(msg.content).toContain("Bijan Robinson");
  });

  it("links back to the game", () => {
    const msg = mustBuild(round(), OPTS);
    expect(msg.content).toContain("https://ffbeacon.com/games/would-you-rather");
  });

  it("asks the league format, with exactly two answers, A first", () => {
    const msg = mustBuild(round(), OPTS);
    // The format is the question, because a first-round pick in a 10-team
    // redraft is not the asset it is in a 12-team superflex dynasty and the
    // button is where the reader is deciding.
    expect(msg.poll?.question).toBe("Who wins? Dynasty 12T SF PPR TEP, start 9");
    expect(msg.poll?.answers).toHaveLength(2);
    // The order IS the mapping: Discord assigns answer id 1 to the first answer,
    // and the ingestion reads id 1 as side A. Swapping these swaps every vote.
    expect(msg.poll?.answers[0].startsWith("A: ")).toBe(true);
    expect(msg.poll?.answers[1].startsWith("B: ")).toBe(true);
  });

  it("names the players in full on the buttons when they fit", () => {
    const msg = mustBuild(round(), OPTS);
    expect(msg.poll?.answers[0]).toBe("A: Ja'Marr Chase");
    expect(msg.poll?.answers[1]).toBe("B: Bijan Robinson");
  });

  it("labels a startup trade as one", () => {
    const msg = mustBuild(
      round({ kind: "startup", startupSeason: 2026 }),
      OPTS,
    );
    expect(msg.content).toContain("Startup draft trade");
  });

  it("shows the seat a startup pick came from", () => {
    const msg = mustBuild(
      round({
        kind: "startup",
        startupSeason: 2026,
        sides: {
          a: [
            asset("Josh Allen", {
              startupPick: { label: "1.02", simulated: false },
            }),
          ],
          b: [
            asset("Bijan Robinson", {
              key: "b-0",
              startupPick: { label: "1.03", simulated: true },
            }),
          ],
        },
      }),
      OPTS,
    );
    expect(msg.content).toContain("via 1.02");
    expect(msg.content).toContain("via 1.03, projected");
  });

  it("keeps every answer inside Discord's 55 character cap", () => {
    const msg = mustBuild(busyRound(), OPTS);
    for (const answer of msg.poll?.answers ?? []) {
      expect(answer.length).toBeLessThanOrEqual(POLL_ANSWER_MAX);
    }
  });

  it("refuses a trade it cannot name inside a poll answer, rather than trimming it", () => {
    // Eight long, distinct names on one side survive no rung of the ladder. The
    // answer is null so the caller takes a different trade: a button listing
    // three of eight players describes a trade nobody proposed.
    const many = Array.from({ length: 8 }, (_, i) =>
      asset(`Christopher Bartholomew Longname ${i}`, { key: `a-${i}` }),
    );
    expect(buildPollMessage(round({ sides: { a: many, b: many } }), OPTS)).toBeNull();
  });

  it("keeps the body inside Discord's 2000 character cap", () => {
    const msg = mustBuild(busyRound(), OPTS);
    expect((msg.content ?? "").length).toBeLessThanOrEqual(MESSAGE_CONTENT_MAX);
  });

  it("truncates with three periods, never the ellipsis character", () => {
    const msg = mustBuild(busyRound(), OPTS);
    const all = [msg.content ?? "", ...(msg.poll?.answers ?? [])].join("\n");
    expect(all).not.toContain("…");
  });

  it("pings only the roles it was given, and lists them for allowed_mentions", () => {
    const msg = mustBuild(round(), {
      ...OPTS,
      mentionRoleIds: ["123456789012345678"],
    });
    expect(msg.content).toContain("<@&123456789012345678>");
    expect(msg.allowedRoleIds).toEqual(["123456789012345678"]);
    // @everyone and @here are refused by the client's allowed_mentions rather
    // than by this builder, but nothing here should ever write them.
    expect(msg.content).not.toContain("@everyone");
    expect(msg.content).not.toContain("@here");
  });

  it("says 'nothing' rather than printing an empty list for a bare side", () => {
    const msg = mustBuild(round({ sides: { a: [asset("Ja'Marr Chase")], b: [] } }), OPTS);
    expect(msg.content).toContain("- nothing");
    expect(msg.poll?.answers[1]).toContain("nothing");
  });

  it("keeps the paragraph breaks between the header, the sides and the link", () => {
    // A filter written to drop the absent mentions slot was dropping every
    // deliberate blank line with it, and the posted message ran all four
    // sections together on consecutive lines. `toContain` assertions could not
    // see that, so the shape is asserted directly.
    const msg = mustBuild(round(), OPTS);
    const lines = (msg.content ?? "").split("\n");
    expect(lines.filter((l: string) => l === "").length).toBe(3);
    expect(lines[0]).toContain("Would You Rather?");
    expect(lines[1]).toContain("The Dynasty League");
    expect(lines[2]).toBe("");
    expect(lines[3]).toBe("**Team A receives**");
  });

  it("puts the mentions on their own line without eating the breaks", () => {
    const msg = mustBuild(round(), {
      ...OPTS,
      mentionRoleIds: ["123456789012345678"],
    });
    const lines = (msg.content ?? "").split("\n");
    expect(lines[0]).toBe("<@&123456789012345678>");
    expect(lines[1]).toBe("");
    expect(lines[2]).toContain("Would You Rather?");
    // Still three section breaks, plus the one after the mentions.
    expect(lines.filter((l: string) => l === "").length).toBe(4);
  });

  it("carries no manager identity of any kind", () => {
    const msg = mustBuild(round(), OPTS);
    const all = [msg.content ?? "", ...(msg.poll?.answers ?? [])].join("\n");
    // The only names the two parties ever get.
    expect(all).toContain("Team A");
    expect(all).toContain("Team B");
    // The DTO carries no owner handle or team name to leak, so this is a guard
    // against a future field being added to WyrRound and rendered here.
    expect(all.toLowerCase()).not.toContain("sleeper.app");
    expect(all).not.toContain("roster_id");
  });
});

/**
 * How a poll row describes itself once it is closed out.
 *
 * 'error' means the message never landed. It does NOT decide whether the trade
 * can go out again; `voters_resolved` and the trade's identity gap do.
 */
describe("pollCloseStatus", () => {
  it("closes a clean read as ingested", () => {
    expect(pollCloseStatus({ note: null, reachedDiscord: true, votersResolved: true })).toBe(
      "ingested",
    );
  });

  it("marks a message that never reached Discord as an error", () => {
    expect(
      pollCloseStatus({
        note: "No Discord message id was recorded.",
        reachedDiscord: false,
        votersResolved: false,
      }),
    ).toBe("error");
  });

  it("does not call a posted poll an error just because the read went badly", () => {
    // Real people may have voted on this one. Calling it an error would
    // misdescribe it; the note carries what actually happened.
    expect(
      pollCloseStatus({
        note: "The bot cannot read that poll (403).",
        reachedDiscord: true,
        votersResolved: false,
      }),
    ).toBe("ingested");
  });
});

/**
 * Turning Discord's two voter lists into rows.
 *
 * The database's unique index on (trade_id, discord_user_id) is what stops a
 * repeat vote across polls. This is the pass before it: whatever cannot be
 * attributed to exactly one side does not become a row at all.
 */
describe("discordVoteRows", () => {
  it("keeps one row per voter, on the side they picked", () => {
    const { rows, dropped } = discordVoteRows({ a: ["1", "2"], b: ["3"] });
    expect(dropped).toEqual([]);
    expect(rows).toEqual([
      { discordUserId: "1", side: "a" },
      { discordUserId: "2", side: "a" },
      { discordUserId: "3", side: "b" },
    ]);
  });

  it("drops anyone listed under both answers rather than guessing a side", () => {
    const { rows, dropped } = discordVoteRows({ a: ["1", "2"], b: ["2", "3"] });
    expect(dropped).toEqual(["2"]);
    expect(rows).toEqual([
      { discordUserId: "1", side: "a" },
      { discordUserId: "3", side: "b" },
    ]);
  });

  it("collapses a voter Discord listed twice under one answer", () => {
    const { rows } = discordVoteRows({ a: ["7", "7"], b: [] });
    expect(rows).toEqual([{ discordUserId: "7", side: "a" }]);
  });

  it("returns nothing for a poll nobody voted on", () => {
    expect(discordVoteRows({ a: [], b: [] })).toEqual({ rows: [], dropped: [] });
  });
});

/**
 * The trade's Discord total: one per identified person, plus the raw counts
 * from polls that could only be counted.
 */
describe("discordTally", () => {
  it("counts one per identified voter", () => {
    expect(
      discordTally([{ side: "a" }, { side: "a" }, { side: "b" }], []),
    ).toEqual({ a: 2, b: 1 });
  });

  it("adds the totals from polls whose voters could not be read", () => {
    expect(
      discordTally(
        [{ side: "a" }],
        [{ ingested_votes_a: 10, ingested_votes_b: 4 }],
      ),
    ).toEqual({ a: 11, b: 4 });
  });

  it("treats a missing count as a zero rather than dropping the poll", () => {
    expect(discordTally([], [{ ingested_votes_a: null, ingested_votes_b: 3 }])).toEqual({
      a: 0,
      b: 3,
    });
  });

  it("is a recompute, so the same input always gives the same answer", () => {
    const identified = [{ side: "a" }, { side: "b" }];
    const counted = [{ ingested_votes_a: 2, ingested_votes_b: 2 }];
    expect(discordTally(identified, counted)).toEqual(discordTally(identified, counted));
  });
});
