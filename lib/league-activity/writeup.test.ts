import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { buildActivityCard } from "./writeup";
import type { ActivityContext, ActivityEvent, ActivityKind } from "./types";

const NOW = Date.parse("2026-09-16T15:00:00.000Z");

const ctx: ActivityContext = {
  sleeperLeagueId: "999",
  teams: {
    1: { label: "Alice FC", owner: "@alice", avatarId: "aaa" },
    2: { label: "@bob", owner: null, avatarId: null },
  },
  players: {
    "100": { name: "Bijan Robinson", position: "RB", team: "ATL" },
    "200": { name: "Puka Nacua", position: "WR", team: "LAR" },
    "300": { name: "Sam LaPorta", position: "TE", team: "DET" },
  },
  searchedUsername: "alice",
  nowMs: NOW,
};

function event(over: Partial<ActivityEvent> & { kind: ActivityKind }): ActivityEvent {
  return {
    id: "evt-1",
    category: "transaction",
    occurredAt: "2026-09-16T14:00:00.000Z",
    precision: "exact",
    observedFrom: null,
    season: 2026,
    week: 2,
    rosterIds: [],
    playerIds: [],
    payload: {},
    ...over,
  } as ActivityEvent;
}

describe("trade", () => {
  const card = buildActivityCard(
    event({
      kind: "trade",
      rosterIds: [1, 2],
      payload: {
        sides: [
          { rosterId: 1, players: ["100"], picks: [], faab: 0 },
          {
            rosterId: 2,
            players: ["200"],
            picks: [{ season: 2027, round: 1, originalRosterId: 1 }],
            faab: 12,
          },
        ],
      },
    }),
    ctx,
  );

  it("gives each side its own column, headed by who receives", () => {
    expect(card.columns).toHaveLength(2);
    expect(card.columns[0].heading).toBe("Receives");
    expect(card.columns[0].chip?.label).toBe("Alice FC");
    expect(card.title).toBe("Alice FC traded with @bob");
    expect(card.columns[0].chip?.label).toBe("Alice FC");
    expect(card.columns[0].assets.map((a) => a.label)).toEqual(["Bijan Robinson"]);
  });

  it("names picks and FAAB rather than dropping them", () => {
    expect(card.columns[1].assets.map((a) => a.label)).toEqual(["Puka Nacua", "2027 1st"]);
    expect(card.columns[1].faab).toBe("$12 FAAB");
  });

  it("points at the transactions page, filtered to this trade's own week", () => {
    expect(card.href).toContain("/leagues/999/transactions");
    expect(card.href).toContain("type=trade");
    expect(card.href).toContain("week=2");
    expect(card.href).toContain("username=alice");
  });
});

describe("waiver", () => {
  it("names the bid and only comments on a big one", () => {
    const small = buildActivityCard(
      event({
        kind: "waiver",
        payload: { rosterId: 1, adds: ["100"], drops: ["300"], bid: 3, status: "complete" },
      }),
      ctx,
    );
    expect(small.stats.find((s) => s.label === "Winning bid")?.value).toBe("$3");
    expect(small.line).toBeNull();

    const big = buildActivityCard(
      event({
        kind: "waiver",
        payload: { rosterId: 1, adds: ["100"], drops: [], bid: 44, status: "complete" },
      }),
      ctx,
    );
    expect(big.line).toBeTruthy();
  });

  it("marks the add in and the drop out", () => {
    const card = buildActivityCard(
      event({
        kind: "waiver",
        payload: { rosterId: 1, adds: ["100"], drops: ["300"], bid: 0, status: "complete" },
      }),
      ctx,
    );
    expect(card.moves.map((m) => [m.label, m.direction])).toEqual([
      ["Bijan Robinson", "in"],
      ["Sam LaPorta", "out"],
    ]);
  });
});

describe("matchup result", () => {
  const base = {
    kind: "matchup_result" as const,
    category: "result" as const,
    precision: "observed" as const,
    week: 6,
    rosterIds: [1, 2],
  };

  it("puts the win and the loss on ONE card", () => {
    const card = buildActivityCard(
      event({
        ...base,
        payload: {
          sides: [
            { rosterId: 1, points: 128.4, benchPoints: 40.2 },
            { rosterId: 2, points: 96.1, benchPoints: 31.5 },
          ],
          margin: 32.3,
          tie: false,
        },
      }),
      ctx,
    );
    expect(card.title).toBe("Alice FC beat @bob, 128.4 to 96.1");
    expect(card.columns.map((c) => c.heading)).toEqual(["Winner", "Loser"]);
    expect(card.columns[0].tone).toBe("win");
    expect(card.columns[1].tone).toBe("loss");
  });

  it("omits a bench total Sleeper never sent, rather than printing zero", () => {
    const card = buildActivityCard(
      event({
        ...base,
        payload: {
          sides: [
            { rosterId: 1, points: 100, benchPoints: null },
            { rosterId: 2, points: 90, benchPoints: null },
          ],
          margin: 10,
          tie: false,
        },
      }),
      ctx,
    );
    expect(card.stats.map((s) => s.label)).toEqual(["Margin"]);
  });

  it("calls out a bench that outscored the margin", () => {
    const card = buildActivityCard(
      event({
        ...base,
        payload: {
          sides: [
            { rosterId: 1, points: 100, benchPoints: 10 },
            { rosterId: 2, points: 96, benchPoints: 55 },
          ],
          margin: 4,
          tie: false,
        },
      }),
      ctx,
    );
    expect(card.footnote).toContain("55.0");
    expect(card.footnote).toContain("4.0");
  });

  it("says tied rather than picking a winner", () => {
    const card = buildActivityCard(
      event({
        ...base,
        payload: {
          sides: [
            { rosterId: 1, points: 110.2, benchPoints: null },
            { rosterId: 2, points: 110.2, benchPoints: null },
          ],
          margin: 0,
          tie: true,
        },
      }),
      ctx,
    );
    expect(card.title).toContain("tied at 110.2");
    expect(card.columns.every((c) => c.tone === "tie")).toBe(true);
  });

  it("shows the week instead of a clock time it does not have", () => {
    const card = buildActivityCard(
      event({
        ...base,
        payload: { sides: [], margin: 0, tie: false },
      }),
      ctx,
    );
    expect(card.timeLabel).toBe("Week 6");
    expect(card.timeNote).toBeNull();
  });
});

describe("observed changes", () => {
  it("says spotted, and prints the window rather than a moment inside it", () => {
    const card = buildActivityCard(
      event({
        kind: "lineup_change",
        category: "lineup",
        precision: "observed",
        observedFrom: "2026-09-16T09:00:00.000Z",
        payload: { rosterId: 1, started: ["300"], benched: ["200"] },
      }),
      ctx,
    );
    expect(card.timeLabel.startsWith("Spotted ")).toBe(true);
    expect(card.timeNote).toContain("between");
    expect(card.title).toContain("Sam LaPorta");
    expect(card.title).toContain("Puka Nacua");
  });

  it("prints the exact time for a transaction", () => {
    const card = buildActivityCard(
      event({ kind: "free_agent", payload: { rosterId: 1, adds: ["100"], drops: [], bid: null } }),
      ctx,
    );
    expect(card.timeLabel.startsWith("Spotted")).toBe(false);
    expect(card.timeNote).toBeNull();
  });
});

describe("settings", () => {
  it("translates a scoring key and warns that values move with it", () => {
    const card = buildActivityCard(
      event({
        kind: "scoring_change",
        category: "settings",
        precision: "observed",
        observedFrom: "2026-09-16T09:00:00.000Z",
        payload: { changes: [{ key: "rec", from: 0.5, to: 1 }] },
      }),
      ctx,
    );
    expect(card.changes[0]).toMatchObject({ label: "Reception", from: "+0.5", to: "+1" });
    expect(card.footnote).toContain("projection");
  });

  it("translates a league setting's VALUE, not just its key", () => {
    const card = buildActivityCard(
      event({
        kind: "league_setting_change",
        category: "settings",
        precision: "observed",
        observedFrom: "2026-09-16T09:00:00.000Z",
        payload: { changes: [{ key: "waiver_type", from: 0, to: 2 }] },
      }),
      ctx,
    );
    expect(card.changes[0]).toMatchObject({
      label: "Waiver system",
      from: "Rolling waiver order",
      to: "FAAB bidding",
    });
  });
});

describe("determinism", () => {
  it("renders the same wording every time, so a feed does not shuffle", () => {
    const e = event({
      kind: "trade",
      payload: {
        sides: [
          { rosterId: 1, players: ["100"], picks: [], faab: 0 },
          { rosterId: 2, players: ["200"], picks: [], faab: 0 },
        ],
      },
    });
    const first = buildActivityCard(e, ctx).line;
    const second = buildActivityCard(e, ctx).line;
    expect(first).toBe(second);
  });
});

describe("every kind produces a usable card", () => {
  const samples: Array<[ActivityKind, Record<string, unknown>]> = [
    ["trade", { sides: [{ rosterId: 1, players: ["100"], picks: [], faab: 0 }] }],
    ["waiver", { rosterId: 1, adds: ["100"], drops: [], bid: 5 }],
    ["free_agent", { rosterId: 1, adds: [], drops: ["100"], bid: null }],
    ["commissioner_move", { rosterId: 1, adds: ["100"], drops: [], bid: null }],
    [
      "matchup_result",
      {
        sides: [
          { rosterId: 1, points: 100, benchPoints: 20 },
          { rosterId: 2, points: 90, benchPoints: 20 },
        ],
        margin: 10,
        tie: false,
      },
    ],
    ["lineup_change", { rosterId: 1, started: ["100"], benched: ["200"] }],
    ["reserve_move", { rosterId: 1, toReserve: ["100"], fromReserve: [], toTaxi: [], fromTaxi: [] }],
    ["scoring_change", { changes: [{ key: "rec", from: 0, to: 1 }] }],
    ["roster_positions_change", { added: ["WR"], removed: [], fromCount: 9, toCount: 10 }],
    ["team_count_change", { from: 10, to: 12 }],
    ["league_setting_change", { changes: [{ key: "trade_deadline", from: 12, to: 10 }] }],
    ["league_renamed", { from: "A", to: "B" }],
    ["league_status_change", { from: "pre_draft", to: "in_season" }],
    ["draft_status_change", { from: "pre_draft", to: "complete", draftId: "d1" }],
    ["manager_joined", { sleeperUserId: "u3", displayName: "carol", teamName: null, rosterId: 1 }],
    ["manager_left", { sleeperUserId: "u3", displayName: "carol", teamName: null, rosterId: 1 }],
    [
      "roster_owner_change",
      { rosterId: 1, fromUserId: "u1", fromLabel: "alice", toUserId: "u3", toLabel: "carol" },
    ],
    ["commissioner_change", { sleeperUserId: "u1", label: "alice", granted: true }],
    [
      "team_identity_change",
      {
        sleeperUserId: "u1",
        rosterId: 1,
        handle: "alice",
        changes: [{ key: "team_name", from: "Old", to: "New" }],
      },
    ],
  ];

  it.each(samples)("%s has a title, an eyebrow and an accessible name", (kind, payload) => {
    const card = buildActivityCard(event({ kind, payload }), ctx);
    expect(card.title.length).toBeGreaterThan(0);
    expect(card.eyebrow.length).toBeGreaterThan(0);

    expect(card.title).not.toContain("undefined");
    expect(card.title).not.toContain("null");
  });

  it.each(samples)("%s survives an empty payload without throwing", (kind) => {
    expect(() => buildActivityCard(event({ kind, payload: {} }), ctx)).not.toThrow();
  });
});

/**
 * CLAUDE.md rule 6, enforced rather than remembered.
 *
 * No em dash, no en dash, no curly quotes, no ellipsis character, no middle dot
 * used as a separator. It is checked against BOTH the rendered strings and the
 * source files, because a card is generated from templates and a template with
 * a banned character in it will only show up on the one league that happens to
 * hit that branch.
 */
const BANNED = /[–—‘’“”…·• ]/;

describe("punctuation", () => {
  it("never renders a banned character", () => {
    for (const [kind, payload] of [
      ["trade", { sides: [{ rosterId: 1, players: ["100"], picks: [], faab: 4 }] }],
      ["waiver", { rosterId: 1, adds: ["100"], drops: ["200"], bid: 40 }],
      [
        "matchup_result",
        {
          sides: [
            { rosterId: 1, points: 100, benchPoints: 60 },
            { rosterId: 2, points: 98, benchPoints: 60 },
          ],
          margin: 2,
          tie: false,
        },
      ],
      ["scoring_change", { changes: [{ key: "rec", from: 0, to: 1 }] }],
      ["lineup_change", { rosterId: 1, started: ["100"], benched: ["200"] }],
    ] as Array<[ActivityKind, Record<string, unknown>]>) {
      const card = buildActivityCard(
        event({ kind, payload, precision: "observed", observedFrom: "2026-09-16T09:00:00.000Z" }),
        ctx,
      );
      const text = JSON.stringify(card);
      expect(BANNED.test(text), `${kind} rendered a banned character`).toBe(false);
    }
  });

  it("never has one in the source of a template or a component", async () => {
    const roots = [
      path.resolve(__dirname),
      path.resolve(__dirname, "../../components/league-activity"),
    ];
    for (const root of roots) {
      for (const file of await fs.readdir(root)) {
        // Test files are excluded because THIS file necessarily contains
        // every banned character: they are in the regex two dozen lines up.
        if (!/\.tsx?$/.test(file) || /\.test\.tsx?$/.test(file)) continue;
        const text = await fs.readFile(path.join(root, file), "utf8");
        const line = text.split("\n").findIndex((l) => BANNED.test(l));
        expect(line, `${file} line ${line + 1} carries a banned character`).toBe(-1);
      }
    }
  });
});
