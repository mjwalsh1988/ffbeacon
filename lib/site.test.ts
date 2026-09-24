/**
 * The position constants and the one position noun helper (plan IDP-102).
 *
 * The guard at the bottom exists because two copies of the same "QB means
 * quarterback" map drifted apart once already (BEAM had one returning the raw
 * code and one returning an empty string), and a third copy is exactly how a
 * defender ends up spoken as "LB" on one page and "linebacker" on the next.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  IDP_POSITIONS,
  OFFENSE_POSITIONS,
  POSITIONS,
  isDefender,
  positionNoun,
} from "./site";

describe("position constants", () => {
  it("keeps the six offensive positions under both names", () => {
    expect(OFFENSE_POSITIONS).toBe(POSITIONS);
    expect([...OFFENSE_POSITIONS]).toEqual(["QB", "RB", "WR", "TE", "K", "DEF"]);
  });

  it("lists the three individual defensive positions", () => {
    expect([...IDP_POSITIONS]).toEqual(["DL", "LB", "DB"]);
  });
});

describe("isDefender", () => {
  it("is true for DL, LB and DB in any case", () => {
    expect(isDefender("DL")).toBe(true);
    expect(isDefender("lb")).toBe(true);
    expect(isDefender("DB")).toBe(true);
  });

  it("is false for the team defense, offense and nothing", () => {
    expect(isDefender("DEF")).toBe(false);
    expect(isDefender("QB")).toBe(false);
    expect(isDefender(null)).toBe(false);
    expect(isDefender(undefined)).toBe(false);
    expect(isDefender("")).toBe(false);
  });
});

describe("positionNoun", () => {
  it("spells out every position in both forms", () => {
    expect(positionNoun("LB", "plural")).toBe("linebackers");
    expect(positionNoun("DL")).toBe("defensive lineman");
    expect(positionNoun("DL", "plural")).toBe("defensive linemen");
    expect(positionNoun("DB", "plural")).toBe("defensive backs");
    expect(positionNoun("QB")).toBe("quarterback");
    expect(positionNoun("DEF")).toBe("team defense");
    expect(positionNoun("te", "plural")).toBe("tight ends");
  });

  it("returns an unknown code as itself and nothing as nothing", () => {
    expect(positionNoun("OL")).toBe("OL");
    expect(positionNoun(null)).toBe("");
  });
});

const ROOTS = ["lib", "components", "app"];
/**
 * Files allowed to hold a position-to-English map. The helper itself, then a
 * debt ledger recorded on 2026-09-24 (IDP-102): maps that existed before the
 * helper and carry DIFFERENT wording on purpose (short "receiver", "defense"
 * rather than "team defense", capitalised group headings, "Streaming
 * defenses"), or sit on surfaces that stay offense-only by plan (draft tools,
 * waiver wire, rankings). Folding them would rewrite copy across the site for
 * no defender gain. A NEW file may not join this list; use positionNoun.
 * Phase 2 and 3 tasks that touch a listed file fold it and delete its line.
 */
const ALLOWED = new Map<string, string>([
  ["lib/site.ts", "the helper"],
  ["lib/league-schedule/slots.ts", "SLOT_GROUP_LABEL: group headings incl. Flex, Superflex, Defensive players"],
  ["lib/on-the-clock/draft-alerts.ts", "draft tools stay offense-only (R-11); short 'receiver' wording"],
  ["lib/on-the-clock/draft-grade.ts", "draft tools stay offense-only; slot words incl. flex tokens"],
  ["lib/on-the-clock/rationale.ts", "draft tools stay offense-only; short 'receiver' wording"],
  ["lib/on-the-clock/recommend.ts", "draft tools stay offense-only; 'defense' wording"],
  ["lib/rankings/faq.ts", "rankings stay offense-only (R-18)"],
  ["lib/signal-scout/clues.ts", "Signal Scout stays offense-only (R-15); four positions only"],
  ["lib/trade-finder/explain.ts", "value-side trade copy; folded in IDP-311"],
  ["lib/trade-finder/types.ts", "exported TRADE_POSITION_LABEL; folded in IDP-311"],
  ["lib/waiver-wire/reasons.ts", "waiver wire board is offense-only; 'defense' wording"],
  ["components/league-lineups/slot-swap-dialog.tsx", "eligible-slot plurals; folded in IDP-305"],
  ["components/league-schedule/player-detail-dialog.tsx", "already carries DL/LB/DB; folded in IDP-304"],
  ["components/team-card.tsx", "ValuedPosition headings; reworked in IDP-209"],
  ["components/waiver-wire/board-rail.tsx", "waiver wire board is offense-only"],
  ["components/waiver-wire/player-card.tsx", "waiver wire board is offense-only"],
  ["components/waiver-wire/top-pickup.tsx", "waiver wire board is offense-only"],
  ["components/waiver-wire/waiver-board.tsx", "group headings incl. 'Streaming defenses'"],
  ["app/guides/dynasty-strategy/dynasty-figures.tsx", "guide figure headings, four positions"],
  ["app/my-beacon/draft-tracker/[trackerId]/team-rosters.tsx", "draft tracker stays offense-only; headings"],
  ["app/tools/on-the-clock/draft-pulse-board.tsx", "slot token labels incl. flex tokens"],
  ["app/tools/on-the-clock/player-spotlight.tsx", "draft tools stay offense-only"],
  ["app/tools/who-should-i-start/toughest-calls.tsx", "K_DEF combined key; board refuses defenders"],
]);

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
}

describe("one position noun map", () => {
  const root = join(__dirname, "..");
  const files: string[] = [];
  for (const r of ROOTS) walk(join(root, r), files);

  it("scans a non-empty set of files", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("finds no second map from position codes to English nouns", () => {
    // A map entry like QB: "quarterback" (or "Quarterbacks"). A colour map or
    // an order map never has an English noun on the right.
    const pattern = /\bQB:\s*["'`]quarterbacks?["'`]/i;
    const offenders = files
      .map((f) => relative(root, f).replace(/\\/g, "/"))
      .filter((rel) => !ALLOWED.has(rel))
      .filter((rel) => pattern.test(readFileSync(join(root, rel), "utf8")));
    expect(offenders).toEqual([]);
  });
});
