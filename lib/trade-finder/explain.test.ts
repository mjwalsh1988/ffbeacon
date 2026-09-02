import { describe, it, expect } from "vitest";
import { buildPitch, buildRationale, listAssets } from "./explain";
import type { SideImpact, SuggestionAsset } from "./types";

const player = (name: string): SuggestionAsset => ({
  kind: "player",
  playerId: name,
  sleeperId: null,
  name,
  position: "WR",
  team: "BUF",
  value: 2000,
  age: 25,
  projPoints: 12,
});

const pick = (label: string): SuggestionAsset => ({
  kind: "pick",
  key: label,
  label,
  season: 2028,
  round: 2,
  value: 2500,
});

const impact = (over: Partial<SideImpact> = {}): SideImpact => ({
  valueDelta: 0,
  lineupDelta: 0,
  winsDelta: null,
  ageDelta: 0,
  pickCountDelta: 0,
  ...over,
});

describe("listAssets", () => {
  it("reads as a person would say it", () => {
    expect(listAssets([player("A")])).toBe("A");
    expect(listAssets([player("A"), player("B")])).toBe("A and B");
    expect(listAssets([player("A"), player("B"), player("C")])).toBe("A, B, and C");
  });
});

describe("buildPitch", () => {
  const base = {
    outgoing: [player("Kevin Coleman"), pick("2028 2nd")],
    incoming: [player("Jeremiyah Love")],
  };

  it("is addressed to the other manager and opens as a question", () => {
    const pitch = buildPitch({
      ...base,
      theirs: impact({ pickCountDelta: 1, valueDelta: 200 }),
      direction: "rebuild",
      valueGap: 0.03,
    });
    expect(pitch).toContain(
      "What do you think of me sending you Kevin Coleman and 2028 2nd, and you sending back Jeremiyah Love?",
    );
  });

  it("never says what the sender gains", () => {
    const pitch = buildPitch({
      ...base,
      theirs: impact({ pickCountDelta: 1, valueDelta: 200 }),
      direction: "rebuild",
      valueGap: 0.03,
    });
    // The whole point: the other manager does not care, and telling them hands
    // over the reason to refuse. No first-person claim of benefit anywhere.
    expect(pitch.toLowerCase()).not.toContain("your starting lineup gains");
    expect(pitch.toLowerCase()).not.toContain("i come out");
    expect(pitch.toLowerCase()).not.toContain("my lineup");
  });

  it("argues from the receiving team's own situation", () => {
    const rebuild = buildPitch({
      ...base,
      theirs: impact({ pickCountDelta: 1, ageDelta: -0.8 }),
      direction: "rebuild",
      valueGap: 0.03,
    });
    expect(rebuild).toContain("1 more draft pick");
    expect(rebuild).toContain("0.8 years off your average age");

    const contender = buildPitch({
      ...base,
      theirs: impact({ lineupDelta: 3.2 }),
      direction: "win-now",
      valueGap: 0.03,
    });
    expect(contender).toContain("+3.2 points a week to your starting lineup");
    // A contender is not sold on getting younger, so that line stays out.
    expect(contender).not.toContain("average age");
  });

  it("does not oversell an age change too small to matter", () => {
    const pitch = buildPitch({
      ...base,
      theirs: impact({ pickCountDelta: 1, ageDelta: -0.1 }),
      direction: "rebuild",
      valueGap: 0.03,
    });
    expect(pitch).not.toContain("average age");
  });

  it("calls a close deal even, measured as a share rather than in points", () => {
    // 91 points down on a 6,500-point trade is a rounding error, and an earlier
    // version said nothing at all because 91 is more than 1.
    const pitch = buildPitch({
      ...base,
      theirs: impact({ valueDelta: -91, lineupDelta: 2 }),
      direction: "win-now",
      valueGap: 0.014,
    });
    expect(pitch).toContain("close to even both ways");
  });

  it("does not point out that they are behind on value", () => {
    const pitch = buildPitch({
      ...base,
      theirs: impact({ valueDelta: -400, pickCountDelta: 1 }),
      direction: "rebuild",
      valueGap: 0.14,
    });
    // Arguing against the trade inside the message that proposes it.
    expect(pitch).not.toContain("even");
    expect(pitch).not.toContain("value");
    expect(pitch).toContain("1 more draft pick");
  });

  it("sends the proposal bare rather than inventing a benefit", () => {
    const pitch = buildPitch({
      ...base,
      theirs: impact({ valueDelta: -400, lineupDelta: -2 }),
      direction: "win-now",
      valueGap: 0.14,
    });
    // Nothing true to say about their side, so the message is the offer alone.
    expect(pitch).toBe(
      "What do you think of me sending you Kevin Coleman and 2028 2nd, and you sending back Jeremiyah Love?",
    );
  });

  it("never reads as a demand or a hard sell", () => {
    const pitch = buildPitch({
      ...base,
      theirs: impact({ pickCountDelta: 1, valueDelta: 300 }),
      direction: "rebuild",
      valueGap: 0.03,
    }).toLowerCase();
    for (const pushy of [
      "you should",
      "great deal",
      "steal",
      "let me know asap",
      "no brainer",
      "!",
    ]) {
      expect(pitch).not.toContain(pushy);
    }
  });
});

/**
 * The opener is paid for by the sentence at the END.
 *
 * buildRationale truncates at 360 characters, and the last clause is the one
 * naming the reader's actual positional hole. A long opener does not read as
 * long, it reads as a sentence that stops mid-word, so the ceiling has to be
 * held by a test rather than by a comment. The strategy clauses shipped at 133
 * and 118 characters against a stance clause of 89, and against a long team
 * name the contender one cut that last sentence in half.
 */
describe("buildRationale stays inside its character budget", () => {
  // Sleeper lets a manager name a team about this long, and formatTeamLabel
  // pairs the name with the handle, so this is not a pathological input.
  const longTeamName = "The Absolutely Enormous Team Name Experience (@managerhandle)";

  const rationale = (strategy: "contender" | "value") =>
    buildRationale({
      strategy,
      direction: "rebuild",
      teamName: longTeamName,
      positionHelped: "running back",
      needPoints: 3.4,
      named: null,
      myDirection: "win-now",
      isDynasty: true,
      mine: impact({ lineupDelta: 2.2, winsDelta: 0.24, valueDelta: 140 }),
    });

  for (const strategy of ["contender", "value"] as const) {
    it(`does not truncate the ${strategy} opener's sentence off the end`, () => {
      const text = rationale(strategy);
      expect(text.length).toBeLessThanOrEqual(360);
      // The END of the string is what has to be checked, not the presence of
      // the position name. Truncation lops the last few characters off, and the
      // position is named early in that final clause, so "does it mention the
      // running back" is true either way. Whether the sentence FINISHES is the
      // question, and it is the one a reader hears.
      expect(text.endsWith("and this deal lands there.")).toBe(true);
    });
  }

  it("names the question the reader actually asked", () => {
    expect(rationale("contender")).toContain("asked for contender deals");
    expect(rationale("value")).toContain("asked for value deals");
  });

  it("lets the reader's stated strategy outrank Power Pulse's read of them", () => {
    // myDirection is win-now above. The stance clause would say "Power Pulse
    // has you competing"; the reader pressed Value, and a card that describes
    // a ranking they are not looking at is worse than one that says nothing.
    expect(rationale("value")).not.toContain("Power Pulse has you competing");
  });
});
