import { describe, it, expect } from "vitest";
import {
  MAX_BUILD_ASSETS_PER_SIDE,
  decodeAsset,
  decodeProposal,
  encodeAsset,
  encodeProposalQuery,
  proposalHref,
} from "./proposal-url";
import type { TradeProposal } from "./types";

const P1 = "6f1c6b2e-3b4a-4c8d-9e1f-2a3b4c5d6e7f";
const P2 = "11111111-2222-4333-8444-555555555555";
const P3 = "99999999-8888-4777-a666-555555555554";

describe("encodeAsset / decodeAsset", () => {
  it("round trips a player", () => {
    const asset = { kind: "player", playerId: P1 } as const;
    expect(decodeAsset(encodeAsset(asset))).toEqual(asset);
  });

  it("round trips a pick", () => {
    const asset = { kind: "pick", season: 2027, round: 1, pickPosition: "mid" } as const;
    expect(decodeAsset(encodeAsset(asset))).toEqual(asset);
  });

  it("lowercases an uppercase uuid so the same player never keys twice", () => {
    const decoded = decodeAsset(P1.toUpperCase());
    expect(decoded).toEqual({ kind: "player", playerId: P1 });
  });

  it("refuses a season outside the plausible range", () => {
    expect(decodeAsset("1066-1-mid")).toBeNull();
    expect(decodeAsset("3000-1-mid")).toBeNull();
  });

  it("refuses a round outside the plausible range", () => {
    expect(decodeAsset("2027-0-mid")).toBeNull();
    expect(decodeAsset("2027-99-mid")).toBeNull();
  });

  it("refuses an unknown slot word", () => {
    expect(decodeAsset("2027-1-somewhere")).toBeNull();
  });

  it("refuses anything that is not a uuid or a pick", () => {
    expect(decodeAsset("")).toBeNull();
    expect(decodeAsset("not-a-thing")).toBeNull();
    expect(decodeAsset("../../etc/passwd")).toBeNull();
    expect(decodeAsset("<script>")).toBeNull();
    expect(decodeAsset("1; drop table players")).toBeNull();
  });
});

describe("decodeProposal", () => {
  it("reads a two-sided trade", () => {
    const { proposal, droppedTokens } = decodeProposal(
      { with: "4", in: `${P1}_2027-1-early`, out: P2 },
      1,
    );
    expect(droppedTokens).toBe(0);
    expect(proposal).toEqual({
      myRosterId: 1,
      theirRosterId: 4,
      incoming: [
        { kind: "player", playerId: P1 },
        { kind: "pick", season: 2027, round: 1, pickPosition: "early" },
      ],
      outgoing: [{ kind: "player", playerId: P2 }],
    });
  });

  it("takes myRosterId from the page, never from the link", () => {
    // A link cannot move whose trade this is. If it could, one person could send
    // another a link that quietly evaluates somebody else's team.
    const { proposal } = decodeProposal({ with: "4", in: P1 }, 7);
    expect(proposal?.myRosterId).toBe(7);
  });

  it("refuses a trade with yourself", () => {
    expect(decodeProposal({ with: "3", in: P1 }, 3).proposal).toBeNull();
  });

  it("returns no proposal when the link names no counterparty", () => {
    expect(decodeProposal({ in: P1 }, 1).proposal).toBeNull();
  });

  it("returns no proposal when both sides are empty", () => {
    expect(decodeProposal({ with: "4" }, 1).proposal).toBeNull();
  });

  it("counts unreadable tokens instead of silently shrinking the trade", () => {
    const { proposal, droppedTokens } = decodeProposal(
      { with: "4", in: `${P1}_garbage_2027-99-mid` },
      1,
    );
    expect(droppedTokens).toBe(2);
    expect(proposal?.incoming).toHaveLength(1);
  });

  it("collapses a duplicated asset so its value cannot be counted twice", () => {
    const { proposal } = decodeProposal({ with: "4", in: `${P1}_${P1}_${P2}` }, 1);
    expect(proposal?.incoming).toHaveLength(2);
  });

  it("caps a side after deduplication, so padding cannot push real assets out", () => {
    // Seven distinct assets, the first six of which are the same player repeated
    // in the raw string. If the cap ran before dedup, P3 would fall off.
    const raw = [P1, P1, P1, P1, P1, P1, P2, P3].join("_");
    const { proposal } = decodeProposal({ with: "4", in: raw }, 1);
    expect(proposal?.incoming.map((a) => (a.kind === "player" ? a.playerId : ""))).toEqual([
      P1,
      P2,
      P3,
    ]);
  });

  it("never returns more than the cap", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      `20${String(27 + (i % 9)).padStart(2, "0")}-${(i % 5) + 1}-mid`,
    ).join("_");
    const { proposal } = decodeProposal({ with: "4", in: many }, 1);
    expect(proposal?.incoming.length).toBeLessThanOrEqual(MAX_BUILD_ASSETS_PER_SIDE);
  });

  it("takes the first value when a param arrives repeated", () => {
    const { proposal } = decodeProposal({ with: ["4", "9"], in: [P1, P2] }, 1);
    expect(proposal?.theirRosterId).toBe(4);
    expect(proposal?.incoming).toEqual([{ kind: "player", playerId: P1 }]);
  });

  it("refuses a non-numeric counterparty", () => {
    expect(decodeProposal({ with: "abc", in: P1 }, 1).proposal).toBeNull();
    expect(decodeProposal({ with: "-1", in: P1 }, 1).proposal).toBeNull();
  });
});

describe("encodeProposalQuery", () => {
  const proposal: TradeProposal = {
    myRosterId: 1,
    theirRosterId: 4,
    incoming: [{ kind: "player", playerId: P1 }],
    outgoing: [{ kind: "pick", season: 2027, round: 2, pickPosition: "late" }],
  };

  it("round trips through decodeProposal", () => {
    const qs = new URLSearchParams(encodeProposalQuery(proposal));
    const { proposal: back } = decodeProposal(
      {
        with: qs.get("with") ?? undefined,
        in: qs.get("in") ?? undefined,
        out: qs.get("out") ?? undefined,
      },
      1,
    );
    expect(back).toEqual(proposal);
  });

  it("carries the reader's source through, so a click cannot reprice the trade", () => {
    const qs = encodeProposalQuery(proposal, { source: "ktc", searchedUsername: "mike" });
    expect(qs).toContain("source=ktc");
    expect(qs).toContain("username=mike");
  });

  it("omits an empty side rather than writing an empty param", () => {
    const qs = encodeProposalQuery({ ...proposal, outgoing: [] });
    expect(qs).not.toContain("out=");
  });

  it("builds an href on the right route", () => {
    expect(proposalHref("12345", proposal)).toMatch(
      /^\/leagues\/12345\/trade-ideas\?mode=build&/,
    );
  });

  it("uses a separator URLSearchParams leaves alone, so the link stays readable", () => {
    const two: TradeProposal = {
      ...proposal,
      incoming: [
        { kind: "player", playerId: P1 },
        { kind: "player", playerId: P2 },
      ],
    };
    expect(encodeProposalQuery(two)).toContain(`${P1}_${P2}`);
  });
});
