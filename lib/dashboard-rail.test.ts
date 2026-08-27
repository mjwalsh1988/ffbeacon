import { describe, expect, it } from "vitest";
import { pageOwnsRail } from "./dashboard-rail";

describe("pageOwnsRail", () => {
  it("gives the rail to a draft board", () => {
    expect(pageOwnsRail("/my-beacon/draft-tracker/11111111-1111-1111-1111-111111111111")).toEqual({
      label: "Your team so far",
    });
  });

  it("leaves the account summary in place everywhere else in the space", () => {
    expect(pageOwnsRail("/my-beacon")).toBeNull();
    expect(pageOwnsRail("/my-beacon/draft-tracker")).toBeNull();
    expect(pageOwnsRail("/my-beacon/rankings")).toBeNull();
    expect(pageOwnsRail("/my-beacon/sleeper-leagues")).toBeNull();
  });

  it("does not give the rail to the setup wizard", () => {
    // /new is a static sibling of [trackerId], so a bare "one segment deeper"
    // test would hand the wizard a rail it has nothing to put in.
    expect(pageOwnsRail("/my-beacon/draft-tracker/new")).toBeNull();
  });

  it("does not reach into a board's own sub-pages", () => {
    expect(pageOwnsRail("/my-beacon/draft-tracker/abc/anything")).toBeNull();
  });

  it("tolerates a trailing slash from a pasted link", () => {
    expect(pageOwnsRail("/my-beacon/draft-tracker/abc/")).not.toBeNull();
    expect(pageOwnsRail("/my-beacon/draft-tracker/new/")).toBeNull();
  });

  it("survives a missing pathname", () => {
    expect(pageOwnsRail(null)).toBeNull();
    expect(pageOwnsRail(undefined)).toBeNull();
    expect(pageOwnsRail("")).toBeNull();
  });
});
