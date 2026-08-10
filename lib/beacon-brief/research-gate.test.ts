import { describe, expect, it } from "vitest";
import {
  researchPrecheck,
  verdictAllowsSkip,
  type ResearchGateVerdict,
} from "./research-gate";

/**
 * The research gate exists to save money, and money is the least important thing
 * about it. Skipping research is how a post reaches the writer with no outside
 * facts attached, and a writer with no facts and an instruction to produce an
 * article will produce one out of whatever it remembers. That is the exact
 * failure migration 0179 was written for: a post reading "Worst part of training
 * camp:" became a 700-word article about a groin injury on a named date at a
 * named joint practice, quoting a coach who was not there. None of it happened.
 *
 * So these tests are not about the happy path. They enumerate every way the gate
 * can be wrong or absent and assert the same answer each time: research anyway.
 * Exactly one input skips.
 */

const ON = {
  gateEnabled: true,
  postChars: 500,
  minPostChars: 180,
  gatePrompt: "decide whether this needs research",
};

describe("researchPrecheck", () => {
  it("asks the model when the gate is on, configured, and the post is long enough", () => {
    expect(researchPrecheck(ON).why).toBe("ask_model");
  });

  it("researches when the gate is turned off", () => {
    // The documented escape hatch. Turning bb_research_gate_enabled off has to
    // restore the pre-0186 behaviour exactly, not skip everything.
    const d = researchPrecheck({ ...ON, gateEnabled: false });
    expect(d.research).toBe(true);
    expect(d.why).toBe("gate_off");
  });

  it("researches when the gate prompt is empty", () => {
    // An admin can clear the prompt field. An empty system prompt would ask the
    // model nothing and get an arbitrary answer back, so never ask at all.
    const d = researchPrecheck({ ...ON, gatePrompt: "" });
    expect(d.research).toBe(true);
    expect(d.why).toBe("no_prompt");
  });

  it("researches a post under the character floor without asking", () => {
    // The floor outranks the gate. This is the 0179 case.
    const d = researchPrecheck({ ...ON, postChars: 26 });
    expect(d.research).toBe(true);
    expect(d.why).toBe("post_too_short");
  });

  it("puts the floor at exactly minPostChars, not one either side", () => {
    expect(researchPrecheck({ ...ON, postChars: 179 }).why).toBe(
      "post_too_short",
    );
    expect(researchPrecheck({ ...ON, postChars: 180 }).why).toBe("ask_model");
  });

  it("never skips on its own: every precheck answer still researches", () => {
    // researchPrecheck cannot authorize a skip under any input. Only the model's
    // explicit false can, and that is verdictAllowsSkip's job. This is the
    // property that keeps a config mistake from becoming a fabricated article.
    for (const gateEnabled of [true, false]) {
      for (const gatePrompt of ["", "ask"]) {
        for (const postChars of [0, 26, 179, 180, 5000]) {
          expect(
            researchPrecheck({
              gateEnabled,
              gatePrompt,
              postChars,
              minPostChars: 180,
            }).research,
          ).toBe(true);
        }
      }
    }
  });

  it("treats a floor of 0 as no floor", () => {
    // Documented on the setting: 0 lets the gate decide on every post.
    expect(researchPrecheck({ ...ON, postChars: 0, minPostChars: 0 }).why).toBe(
      "ask_model",
    );
  });
});

describe("verdictAllowsSkip", () => {
  it("skips only on an explicit needs_research of false", () => {
    expect(
      verdictAllowsSkip({ needs_research: false, reason: "post is complete" }),
    ).toBe(true);
  });

  it("researches when the model asked for research", () => {
    expect(
      verdictAllowsSkip({ needs_research: true, reason: "post links out" }),
    ).toBe(false);
  });

  it("researches when the call failed", () => {
    // runStructuredCall returns null on an API error, a timeout, or an
    // unparseable body. Silence is not a "no".
    expect(verdictAllowsSkip(null)).toBe(false);
  });

  it("researches when the field is missing or the wrong type", () => {
    // The JSON schema requires the field, but the schema is enforced by the API,
    // not by us. Anything that is not literally false has to research.
    const junk = [
      {},
      { reason: "no verdict field" },
      { needs_research: undefined },
      { needs_research: null },
      { needs_research: "false" },
      { needs_research: 0 },
      { needs_research: "" },
    ] as unknown as ResearchGateVerdict[];
    for (const v of junk) {
      expect(verdictAllowsSkip(v)).toBe(false);
    }
  });

  it("does not treat a falsy-but-not-false value as permission to skip", () => {
    // The bug this guards against is a truthiness check. `!verdict.needs_research`
    // would return true for 0, "", null, and undefined, turning every malformed
    // response into a skipped research call.
    expect(verdictAllowsSkip({ needs_research: 0 } as never)).toBe(false);
    expect(verdictAllowsSkip({ needs_research: "" } as never)).toBe(false);
  });
});
