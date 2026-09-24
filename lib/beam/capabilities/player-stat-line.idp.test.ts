import { describe, expect, it } from "vitest";
import { defenderStatLineAnswer } from "./player-stat-line";

describe("BEAM's stat line for a defender (IDP-125)", () => {
  it("declines in words rather than reading back an offensive line of zeros", () => {
    const answer = defenderStatLineAnswer("Roquan Smith");
    expect(answer.headline).toContain("Defensive stat lines arrive with IDP support");
    expect(answer.headline).toContain("Roquan Smith");
    expect(answer.facts).toEqual([]);
    const text = JSON.stringify(answer);
    for (const word of ["rushing", "receiving", "Receptions", "PPR"]) expect(text).not.toContain(word);
  });
});
