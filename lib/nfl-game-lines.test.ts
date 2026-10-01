import { describe, expect, it } from "vitest";
import { parseAmericanNumber, parseEspnGameLine } from "./nfl-odds";
import { eventIdFromMetadata } from "./sync-nfl-game-lines";

/**
 * A trimmed copy of ESPN's per-event odds document for Falcons at Packers,
 * week 3 of 2026 (event 401872948), as fetched 2026-09-30. Only the fields
 * the parser reads are kept.
 */
const ATL_AT_GB = {
  count: 1,
  items: [
    {
      provider: { id: "100", name: "DraftKings", priority: 1 },
      details: "GB -4.5",
      overUnder: 43.5,
      spread: -4.5,
      overOdds: -105.0,
      underOdds: -115.0,
      open: { total: { alternateDisplayValue: "46.5", american: "46.5" } },
      close: { total: { alternateDisplayValue: "43.5", american: "43.5" } },
      awayTeamOdds: {
        favorite: false,
        moneyLine: 195,
        open: { pointSpread: { american: "+7.5" }, moneyLine: { american: "+285" } },
        close: { pointSpread: { american: "+4.5" }, moneyLine: { american: "+195" } },
      },
      homeTeamOdds: {
        favorite: true,
        moneyLine: -238,
        open: { pointSpread: { american: "-7.5" }, moneyLine: { american: "-360" } },
        close: { pointSpread: { american: "-4.5" }, moneyLine: { american: "-238" } },
      },
    },
  ],
};

describe("parseEspnGameLine", () => {
  it("reads the open and close spread from the home side, the totals and the closing moneylines", () => {
    const line = parseEspnGameLine(ATL_AT_GB, "GB", "ATL");
    expect(line).not.toBeNull();
    expect(line).toMatchObject({
      provider: "DraftKings",
      openHomeSpread: -7.5,
      closeHomeSpread: -4.5,
      openGameTotal: 46.5,
      closeGameTotal: 43.5,
      homeMoneyline: -238,
      awayMoneyline: 195,
      overOdds: -105,
      underOdds: -115,
    });
  });

  it("falls back to the details string for the close when the side quote is missing", () => {
    const item = { ...ATL_AT_GB.items[0], homeTeamOdds: { favorite: true } };
    const line = parseEspnGameLine({ items: [item] }, "GB", "ATL");
    expect(line?.closeHomeSpread).toBe(-4.5);
    expect(line?.openHomeSpread).toBeNull();
  });

  it("keeps an away favourite positive, matching nfl_game_odds.home_spread", () => {
    const item = {
      ...ATL_AT_GB.items[0],
      details: "ATL -3",
      homeTeamOdds: { close: { pointSpread: { american: "+3" } } },
    };
    expect(parseEspnGameLine({ items: [item] }, "GB", "ATL")?.closeHomeSpread).toBe(3);
  });

  it("returns null for a document with no odds item", () => {
    expect(parseEspnGameLine({ count: 0, items: [] }, "GB", "ATL")).toBeNull();
    expect(parseEspnGameLine(null, "GB", "ATL")).toBeNull();
  });
});

describe("parseAmericanNumber", () => {
  it("reads signed strings, pick'em and refuses anything else", () => {
    expect(parseAmericanNumber("+4.5")).toBe(4.5);
    expect(parseAmericanNumber({ american: "-110" })).toBe(-110);
    expect(parseAmericanNumber("EVEN")).toBe(0);
    expect(parseAmericanNumber("10/11")).toBeNull();
    expect(parseAmericanNumber(undefined)).toBeNull();
  });
});

describe("eventIdFromMetadata", () => {
  it("reads the competition id and refuses anything that is not digits", () => {
    expect(eventIdFromMetadata({ id: "401872948" })).toBe("401872948");
    expect(eventIdFromMetadata({ id: 401872948 })).toBe("401872948");
    expect(eventIdFromMetadata({ id: "../events" })).toBeNull();
    expect(eventIdFromMetadata(null)).toBeNull();
  });
});
