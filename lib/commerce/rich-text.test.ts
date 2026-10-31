import { describe, expect, it } from "vitest";
import { blocksToText, parseRichText } from "./rich-text";

describe("parseRichText", () => {
  it("splits paragraphs on a blank line and joins wrapped lines", () => {
    expect(parseRichText("one\ntwo\n\nthree")).toEqual([
      { kind: "paragraph", text: "one two" },
      { kind: "paragraph", text: "three" },
    ]);
  });

  it("reads a subheading", () => {
    expect(parseRichText("## Direction")).toEqual([{ kind: "heading", text: "Direction" }]);
  });

  it("gathers a run of bullets", () => {
    expect(parseRichText("- a\n- b\n\n- c")).toEqual([
      { kind: "bullets", items: ["a", "b"] },
      { kind: "bullets", items: ["c"] },
    ]);
  });

  it("gathers a numbered list", () => {
    expect(parseRichText("1. first\n2. second")).toEqual([
      { kind: "numbered", items: ["first", "second"] },
    ]);
  });

  it("turns a bare URL line into a link and leaves a URL inside a sentence alone", () => {
    expect(parseRichText("https://ffbeacon.com/rankings")).toEqual([
      { kind: "link", href: "https://ffbeacon.com/rankings" },
    ]);
    expect(parseRichText("see https://ffbeacon.com now")[0].kind).toBe("paragraph");
  });

  it("does not make a link of anything but http", () => {
    expect(parseRichText("javascript:alert(1)")[0].kind).toBe("paragraph");
  });

  it("handles a mixed document in order", () => {
    const kinds = parseRichText(
      "Intro\n\n## Heading\nBody after\n- one\n1. two\nhttps://a.example/b\nlast",
    ).map((b) => b.kind);
    expect(kinds).toEqual([
      "paragraph",
      "heading",
      "paragraph",
      "bullets",
      "numbered",
      "link",
      "paragraph",
    ]);
  });

  it("keeps a script tag as text", () => {
    expect(parseRichText("<script>alert(1)</script>")).toEqual([
      { kind: "paragraph", text: "<script>alert(1)</script>" },
    ]);
  });

  it("returns nothing for an empty body", () => {
    expect(parseRichText("")).toEqual([]);
    expect(parseRichText(" \n\n ")).toEqual([]);
  });

  it("takes a 20000-character body", () => {
    const body = Array.from({ length: 400 }, () => "x".repeat(48)).join("\n\n");
    const blocks = parseRichText(body);
    expect(blocks).toHaveLength(400);
  });

  it("normalizes Windows line endings", () => {
    expect(parseRichText("a\r\n\r\nb")).toHaveLength(2);
  });
});

describe("blocksToText", () => {
  it("writes the blocks back as plain words", () => {
    expect(blocksToText(parseRichText("## H\n\nP\n\n- a\n- b\n\n1. c"))).toBe(
      "H\n\nP\n\n- a\n- b\n\n1. c",
    );
  });
});
