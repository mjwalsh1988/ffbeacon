import { describe, expect, it } from "vitest";
import { preferredSourceHref } from "./preferred-source";

describe("preferredSourceHref", () => {
  it("points Google's preferred source page at the bare domain", () => {
    expect(preferredSourceHref("https://ffbeacon.com")).toBe(
      "https://www.google.com/preferences/source?q=ffbeacon.com",
    );
  });

  it("drops a leading www and any path", () => {
    expect(preferredSourceHref("https://www.ffbeacon.com/brief")).toBe(
      "https://www.google.com/preferences/source?q=ffbeacon.com",
    );
  });
});
