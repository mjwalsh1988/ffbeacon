import { describe, expect, it } from "vitest";
import {
  DEFAULT_DRAFT_NAME,
  describeAnswer,
  describeStepPosition,
  emptyWizardDraft,
  isStartedDraft,
  parseWizardDraft,
  wizardSteps,
  type WizardDraft,
} from "./wizard";

const FORMATS = ["redraft-ppr-std", "dynasty-ppr-sflex"];
const DEFAULT_FORMAT = "redraft-ppr-std";

function draftWith(over: Partial<WizardDraft> = {}): WizardDraft {
  return { ...emptyWizardDraft(DEFAULT_FORMAT), ...over };
}

describe("wizardSteps", () => {
  const ALL_FIVE = ["format", "order", "tracking", "room", "name"];

  it("asks about the room whichever way the reader is tracking", () => {
    // The size of the room is what turns a pick into a draft slot, so it is
    // needed even when only one roster is being kept.
    expect(wizardSteps("mine")).toEqual(ALL_FIVE);
    expect(wizardSteps("all")).toEqual(ALL_FIVE);
  });

  it("asks the format first, because it decides which source names the ordering", () => {
    expect(wizardSteps("mine")[0]).toBe("format");
    expect(wizardSteps("all")[0]).toBe("format");
  });
});

describe("describeStepPosition", () => {
  it("counts against the steps actually being asked", () => {
    expect(describeStepPosition("name", wizardSteps("mine"))).toBe(
      "Step 5 of 5. What should we call this draft?",
    );
    expect(describeStepPosition("room", wizardSteps("all"))).toBe(
      "Step 4 of 5. How big is the draft?",
    );
  });

  it("falls back to the bare question for a step not in the list", () => {
    expect(describeStepPosition("room", [])).toBe("How big is the draft?");
  });
});

describe("describeAnswer", () => {
  const context = {
    formatLabel: "Dynasty PPR SF",
    sourceLabel: "KeepTradeCut",
    teamCount: 12,
    teamLabelFor: (slot: number) => (slot === 3 ? "Sarah" : `Team ${slot + 1}`),
  };

  it("reads each settled answer back in the reader's own terms", () => {
    const draft = draftWith({ trackingMode: "all", myTeamSlot: 3, orderBy: "adp" });
    expect(describeAnswer("format", draft, context)).toBe("Dynasty PPR SF");
    expect(describeAnswer("order", draft, context)).toBe("Sleeper ADP");
    expect(describeAnswer("tracking", draft, context)).toBe("Every team");
    expect(describeAnswer("room", draft, context)).toBe("12 teams, you are Sarah");
  });

  it("leaves the seat out of the room answer when only one roster is kept", () => {
    const draft = draftWith({ trackingMode: "mine" });
    expect(describeAnswer("room", draft, context)).toBe("12 teams");
  });

  it("names the source in the value ordering", () => {
    expect(describeAnswer("order", draftWith({ orderBy: "value" }), context)).toBe(
      "Player value (KeepTradeCut)",
    );
  });

  it("shows the name the draft will actually get when the box is left blank", () => {
    expect(describeAnswer("name", draftWith({ name: "   " }), context)).toBe(
      DEFAULT_DRAFT_NAME,
    );
    expect(describeAnswer("name", draftWith({ name: "Home league" }), context)).toBe(
      "Home league",
    );
  });
});

describe("parseWizardDraft", () => {
  const options = { validFormatSlugs: FORMATS, fallbackFormatSlug: DEFAULT_FORMAT };

  it("restores a setup written by this version", () => {
    const saved = draftWith({
      formatSlug: "dynasty-ppr-sflex",
      orderBy: "adp",
      trackingMode: "all",
      teamCountText: "14",
      myTeamSlot: 5,
      teamNames: ["Mike", "Sarah"],
      name: "Home league",
    });
    expect(parseWizardDraft(JSON.parse(JSON.stringify(saved)), options)).toEqual(saved);
  });

  it("refuses anything that is not an object", () => {
    expect(parseWizardDraft(null, options)).toBeNull();
    expect(parseWizardDraft("nope", options)).toBeNull();
    expect(parseWizardDraft(7, options)).toBeNull();
  });

  it("drops a format that no longer exists rather than pointing the board at nothing", () => {
    const parsed = parseWizardDraft({ formatSlug: "retired-format" }, options);
    expect(parsed?.formatSlug).toBe(DEFAULT_FORMAT);
  });

  it("falls back on every field it does not recognise", () => {
    const parsed = parseWizardDraft(
      {
        formatSlug: 12,
        orderBy: "by-vibes",
        trackingMode: "everyone",
        teamCountText: "twelve",
        myTeamSlot: -4,
        teamNames: "Mike",
        name: 99,
      },
      options,
    );
    expect(parsed).toEqual({
      formatSlug: DEFAULT_FORMAT,
      orderBy: "value",
      trackingMode: "mine",
      teamCountText: "12",
      myTeamSlot: 0,
      teamNames: [],
      name: "",
    });
  });

  it("caps the pieces a hand-edited entry could blow up", () => {
    const parsed = parseWizardDraft(
      {
        teamNames: Array.from({ length: 500 }, () => "x"),
        name: "n".repeat(500),
      },
      options,
    );
    expect(parsed?.teamNames).toHaveLength(32);
    expect(parsed?.name).toHaveLength(80);
  });

  it("keeps only string entries in the team names", () => {
    const parsed = parseWizardDraft({ teamNames: ["Mike", 7, null] }, options);
    expect(parsed?.teamNames).toEqual(["Mike", "", ""]);
  });
});

describe("isStartedDraft", () => {
  it("is false for an untouched setup, so nothing is offered to restore", () => {
    expect(isStartedDraft(emptyWizardDraft(DEFAULT_FORMAT), DEFAULT_FORMAT)).toBe(false);
  });

  it("is true once any answer has moved", () => {
    expect(isStartedDraft(draftWith({ name: "Home league" }), DEFAULT_FORMAT)).toBe(true);
    expect(isStartedDraft(draftWith({ orderBy: "adp" }), DEFAULT_FORMAT)).toBe(true);
    expect(isStartedDraft(draftWith({ trackingMode: "all" }), DEFAULT_FORMAT)).toBe(true);
    expect(
      isStartedDraft(draftWith({ formatSlug: "dynasty-ppr-sflex" }), DEFAULT_FORMAT),
    ).toBe(true);
    expect(isStartedDraft(draftWith({ teamCountText: "14" }), DEFAULT_FORMAT)).toBe(true);
    expect(isStartedDraft(draftWith({ myTeamSlot: 2 }), DEFAULT_FORMAT)).toBe(true);
    expect(isStartedDraft(draftWith({ teamNames: ["Mike"] }), DEFAULT_FORMAT)).toBe(true);
  });

  it("ignores blank team names, which are the default for every slot", () => {
    expect(isStartedDraft(draftWith({ teamNames: ["", "  "] }), DEFAULT_FORMAT)).toBe(false);
  });
});
