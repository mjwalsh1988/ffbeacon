import { describe, expect, it } from "vitest";
import { sleeperAvatarUrl } from "./sleeper-avatar-url";

describe("sleeperAvatarUrl", () => {
  it("builds both sizes", () => {
    expect(sleeperAvatarUrl("ab12cd34")).toBe(
      "https://sleepercdn.com/avatars/ab12cd34",
    );
    expect(sleeperAvatarUrl("ab12cd34", "thumb")).toBe(
      "https://sleepercdn.com/avatars/thumbs/ab12cd34",
    );
  });

  it("returns null for nothing", () => {
    expect(sleeperAvatarUrl(null)).toBeNull();
    expect(sleeperAvatarUrl(undefined)).toBeNull();
    expect(sleeperAvatarUrl("")).toBeNull();
    expect(sleeperAvatarUrl("   ")).toBeNull();
  });

  it("refuses an id that could leave the path segment", () => {
    expect(sleeperAvatarUrl("../../evil")).toBeNull();
    expect(sleeperAvatarUrl("a/b")).toBeNull();
    expect(sleeperAvatarUrl("evil.com")).toBeNull();
    expect(sleeperAvatarUrl("a:b")).toBeNull();
    expect(sleeperAvatarUrl("a?b=c")).toBeNull();
    expect(sleeperAvatarUrl("a".repeat(65))).toBeNull();
  });
});
