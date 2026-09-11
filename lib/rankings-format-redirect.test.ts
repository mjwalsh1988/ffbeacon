import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { rankingsFormatRedirect } from "./rankings-format-redirect";

const ORIGIN = "https://ffbeacon.com";

function redirectFor(path: string) {
  return rankingsFormatRedirect(new NextRequest(new URL(path, ORIGIN)));
}

function locationOf(path: string): string | null {
  return redirectFor(path)?.headers.get("location") ?? null;
}

describe("rankingsFormatRedirect", () => {
  it("moves the legacy hub address to the format's own path with a 308", () => {
    const res = redirectFor("/rankings?format=dynasty-ppr-sflex");
    expect(res?.status).toBe(308);
    expect(res?.headers.get("location")).toBe(
      `${ORIGIN}/rankings/dynasty-ppr-sflex`,
    );
  });

  it("keeps position and source, in order, and drops only format", () => {
    expect(
      locationOf("/rankings?position=WR&format=redraft-ppr-std&source=ktc"),
    ).toBe(`${ORIGIN}/rankings/redraft-ppr-std?position=WR&source=ktc`);
  });

  it("moves a format page carrying a different format to that format", () => {
    expect(
      locationOf("/rankings/redraft-ppr-std?format=dynasty-ppr-sflex&position=QB"),
    ).toBe(`${ORIGIN}/rankings/dynasty-ppr-sflex?position=QB`);
  });

  it("drops a format parameter that repeats the page's own format", () => {
    expect(locationOf("/rankings/redraft-ppr-std?format=redraft-ppr-std")).toBe(
      `${ORIGIN}/rankings/redraft-ppr-std`,
    );
  });

  it("drops the hub's view flag when it moves the reader onto a board", () => {
    expect(
      locationOf("/rankings?view=formats&format=dynasty-ppr-sflex&source=ktc"),
    ).toBe(`${ORIGIN}/rankings/dynasty-ppr-sflex?source=ktc`);
  });

  it("lowercases a format written in capitals", () => {
    expect(locationOf("/rankings?format=DYNASTY-PPR-SFLEX")).toBe(
      `${ORIGIN}/rankings/dynasty-ppr-sflex`,
    );
  });

  it("drops a malformed format and stays on the page that was asked for", () => {
    for (const bad of [
      "dynasty_ppr",
      "../admin",
      "https://evil.example",
      "//evil.example",
      "dynasty--ppr",
      "-dynasty",
      "a".repeat(65),
    ]) {
      const location = locationOf(
        `/rankings/redraft-ppr-std?format=${encodeURIComponent(bad)}`,
      );
      expect(location).toBe(`${ORIGIN}/rankings/redraft-ppr-std`);
    }
  });

  it("drops an empty format", () => {
    expect(locationOf("/rankings?format=")).toBe(`${ORIGIN}/rankings`);
  });

  it("removes every format parameter and follows the first", () => {
    expect(
      locationOf("/rankings?format=dynasty-ppr-std&format=redraft-ppr-std"),
    ).toBe(`${ORIGIN}/rankings/dynasty-ppr-std`);
  });

  it("leaves a rankings URL with no format parameter alone", () => {
    expect(redirectFor("/rankings")).toBeNull();
    expect(redirectFor("/rankings/dynasty-ppr-sflex?source=ktc")).toBeNull();
  });

  it("leaves every other path alone, format parameter or not", () => {
    expect(redirectFor("/players/josh-allen-4984?format=dynasty-ppr-sflex")).toBeNull();
    expect(redirectFor("/rankings/a/b?format=dynasty-ppr-sflex")).toBeNull();
    expect(redirectFor("/rankingsx?format=dynasty-ppr-sflex")).toBeNull();
    expect(redirectFor("/?format=dynasty-ppr-sflex")).toBeNull();
  });
});
