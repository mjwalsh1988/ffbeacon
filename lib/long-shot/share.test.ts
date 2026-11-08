import { describe, expect, it } from "vitest";
import { buildShareText } from "./share";

describe("buildShareText", () => {
  it("builds the three-line text", () => {
    expect(buildShareText(["chalk", "field", "deep", "sleeper", "long_shot"], 285, 0, "2026-11-07")).toBe(
      "Long Shot, Nov 7, 2026\nC F D S L = 285\nffbeacon.com/games/long-shot",
    );
  });

  it("uses X for a miss or timeout", () => {
    expect(buildShareText(["chalk", null, "deep", null, "field"], 100, 0, "2026-11-07").split("\n")[1]).toBe(
      "C X D X F = 100",
    );
  });

  it("has n letters on a short day", () => {
    expect(buildShareText(["chalk", "deep", "sleeper"], 155, 0, "2026-11-07").split("\n")[1]).toBe("C D S = 155");
  });

  it("appends the bonus only when non-zero", () => {
    expect(buildShareText(["long_shot"], 100, 15, "2026-11-07").split("\n")[1]).toBe("L = 100 +15 Lone Signal");
    expect(buildShareText(["long_shot"], 100, 0, "2026-11-07")).not.toContain("Lone Signal");
  });

  it("contains no character outside ASCII", () => {
    expect(buildShareText(["chalk", null], 10, 15, "2026-01-01")).toMatch(/^[\x0A\x20-\x7E]+$/);
  });
});
