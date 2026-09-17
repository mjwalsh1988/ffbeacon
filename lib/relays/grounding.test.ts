import { describe, expect, it } from "vitest";
import { checkRelayGrounding, numberCandidates } from "./grounding";

const POST = {
  text: "Eagles are placing RB Saquon Barkley on IR with a high ankle sprain, per source. He is expected to miss 4-6 weeks. His deal was $54 million over three years.",
  playerNames: ["Saquon Barkley"],
  teamNames: ["Philadelphia Eagles", "PHI", "Eagles", "Philadelphia"],
};

describe("numberCandidates", () => {
  it("reads money suffixes as both the short and the long form", () => {
    expect(numberCandidates("$54M")[0].values).toEqual([54, 54_000_000]);
    expect(numberCandidates("$54,000,000")[0].values).toEqual([54_000_000]);
    expect(numberCandidates("1.5 billion")[0].values).toEqual([1.5, 1_500_000_000]);
  });

  it("splits a range and a clock time into their parts", () => {
    expect(numberCandidates("4-6 weeks").map((n) => n.values[0])).toEqual([4, 6]);
    expect(numberCandidates("7:30 AM").map((n) => n.values[0])).toEqual([7, 30]);
  });

  it("reads ordinals as the figure they are", () => {
    expect(numberCandidates("a 3rd round pick in 2028").map((n) => n.values[0])).toEqual([3, 2028]);
    expect(numberCandidates("21st on the depth chart")[0].values).toEqual([21]);
  });

  it("does not chop a digit-leading name down to its first digit", () => {
    expect(numberCandidates("49ers")).toEqual([]);
  });
});

describe("checkRelayGrounding", () => {
  it("passes a relay lifted from the post", () => {
    const out = checkRelayGrounding(POST, {
      headline: "Eagles place Saquon Barkley on injured reserve with a high ankle sprain.",
      facts: [
        { label: "Injury", value: "high ankle sprain" },
        { label: "Timeline", value: "4 to 6 weeks" },
        { label: "Contract", value: "$54M over 3 years" },
      ],
      timeline: "4 to 6 weeks",
    });
    expect(out.failures).toEqual([]);
    expect(out.ok).toBe(true);
  });

  it("fails a number the post never gave", () => {
    const out = checkRelayGrounding(POST, {
      headline: "Eagles place Saquon Barkley on injured reserve.",
      facts: [{ label: "Timeline", value: "8 weeks" }],
      timeline: "8 weeks",
    });
    expect(out.ok).toBe(false);
    expect(out.failures.map((f) => f.check)).toContain("number");
    expect(out.failures.some((f) => f.token === "8")).toBe(true);
  });

  it("fails a team or a name the post never mentioned", () => {
    const out = checkRelayGrounding(POST, {
      headline: "Eagles place Saquon Barkley on injured reserve; Kenneth Gainwell takes over.",
      facts: [],
      timeline: null,
    });
    expect(out.ok).toBe(false);
    expect(out.failures.map((f) => f.token)).toEqual(["Kenneth", "Gainwell"]);
  });

  it("accepts a resolved team name the post only abbreviated", () => {
    const post = { ...POST, text: "PHI placing Saquon Barkley on IR, high ankle sprain." };
    const out = checkRelayGrounding(post, {
      headline: "Eagles place Saquon Barkley on injured reserve.",
      facts: [{ label: "Injury", value: "high ankle sprain" }],
      timeline: null,
    });
    expect(out.ok).toBe(true);
  });

  it("matches a money figure written differently, and a word number", () => {
    const post = { ...POST, text: "Barkley signs for $54,000,000 and is out four to six weeks." };
    const out = checkRelayGrounding(post, {
      headline: "Barkley signs a $54M deal.",
      facts: [{ label: "Timeline", value: "4-6 weeks" }],
      timeline: "4-6 weeks",
    });
    expect(out.failures).toEqual([]);
  });

  it("fails a fact value that shares no content word with the post", () => {
    const out = checkRelayGrounding(POST, {
      headline: "Eagles place Saquon Barkley on injured reserve.",
      facts: [{ label: "Also", value: "expected back for the playoffs" }],
      timeline: null,
    });
    expect(out.ok).toBe(false);
    expect(out.failures.some((f) => f.check === "fact")).toBe(true);
  });

  it("reads the quoted post as part of the source", () => {
    const post = {
      text: "More on this.",
      quotedText: "Jalen Hurts is questionable with a knee injury.",
      playerNames: [],
      teamNames: [],
    };
    const out = checkRelayGrounding(post, {
      headline: "Jalen Hurts is questionable with a knee injury.",
      facts: [{ label: "Status", value: "questionable" }],
      timeline: null,
    });
    expect(out.ok).toBe(true);
  });

  it("lets a spelled-out position, a hyphenated form and a sentence-initial verb through", () => {
    const post = {
      text: "The Bears activated quarterback Caleb Williams, a Pro-Bowl pick, from the PUP list.",
      playerNames: ["Caleb Williams"],
      teamNames: ["Chicago Bears", "CHI"],
    };
    const out = checkRelayGrounding(post, {
      headline: "Activated: Bears QB Caleb Williams comes off the PUP list.",
      facts: [{ label: "Also", value: "Pro Bowl pick" }],
      timeline: null,
    });
    expect(out.failures).toEqual([]);
  });

  it("still fails an invented name at the start of a sentence", () => {
    const out = checkRelayGrounding(POST, {
      headline: "Gainwell takes over for Saquon Barkley.",
      facts: [],
      timeline: null,
    });
    expect(out.failures.map((f) => f.token)).toEqual(["Gainwell"]);
  });

  it("fails a draft round the post never gave, in digits or in words", () => {
    const post = {
      text: "The Rams are sending a 2nd round pick to Cleveland for the receiver.",
      playerNames: [],
      teamNames: ["Los Angeles Rams", "Rams", "Cleveland Browns", "Cleveland"],
    };
    const digits = checkRelayGrounding(post, {
      headline: "Rams send a 1st round pick to Cleveland.",
      facts: [],
      timeline: null,
    });
    expect(digits.ok).toBe(false);
    expect(digits.failures.some((f) => f.check === "number" && f.token === "1st")).toBe(true);

    const words = checkRelayGrounding(post, {
      headline: "Rams send a first round pick to Cleveland.",
      facts: [],
      timeline: null,
    });
    expect(words.ok).toBe(false);
    expect(words.failures.some((f) => f.check === "number" && f.token === "first")).toBe(true);

    const right = checkRelayGrounding(post, {
      headline: "Rams send a 2nd round pick to Cleveland.",
      facts: [],
      timeline: null,
    });
    expect(right.ok).toBe(true);
  });

  it("checks the team whose name starts with a digit", () => {
    const post = {
      text: "Seattle placed the tight end on injured reserve.",
      playerNames: [],
      teamNames: ["Seattle Seahawks", "SEA", "Seattle"],
    };
    const out = checkRelayGrounding(post, {
      headline: "49ers place the tight end on injured reserve.",
      facts: [],
      timeline: null,
    });
    expect(out.failures.map((f) => f.token)).toEqual(["49ers"]);
  });

  it("checks fact labels for a team name and for nothing else", () => {
    const out = checkRelayGrounding(POST, {
      headline: "Eagles place Saquon Barkley on injured reserve.",
      facts: [{ label: "Chiefs sent", value: "high ankle sprain" }],
      timeline: null,
    });
    expect(out.ok).toBe(false);
    expect(out.failures.some((f) => f.check === "name" && f.token === "Chiefs")).toBe(true);

    // Title-case framing words are the label's own vocabulary, not claims.
    const generic = checkRelayGrounding(POST, {
      headline: "Eagles place Saquon Barkley on injured reserve.",
      facts: [
        { label: "Event", value: "high ankle sprain" },
        { label: "Practice Status", value: "injured reserve" },
        { label: "Medical Assessment", value: "high ankle sprain" },
      ],
      timeline: null,
    });
    expect(generic.failures).toEqual([]);
  });

  it("requires a content word even when every number in the fact matched", () => {
    const out = checkRelayGrounding(POST, {
      headline: "Eagles place Saquon Barkley on injured reserve.",
      facts: [{ label: "Contract", value: "3 year rookie option picked up" }],
      timeline: null,
    });
    expect(out.ok).toBe(false);
    expect(out.failures.some((f) => f.check === "fact")).toBe(true);
  });

  it("does not fail on sentence-initial function words or possessives", () => {
    const out = checkRelayGrounding(POST, {
      headline: "The Eagles' star back Saquon Barkley lands on IR.",
      facts: [],
      timeline: null,
    });
    expect(out.failures).toEqual([]);
  });
});
