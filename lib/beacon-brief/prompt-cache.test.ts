import { describe, expect, it } from "vitest";
import { shouldCacheSystemPrompt } from "./ai";

/**
 * Which system prompts get marked for caching.
 *
 * Caching is billing-only, so nothing here can affect article quality. What it
 * protects is the economics: the marker has to land on the prompts the model
 * will actually cache, and stay off the ones it won't, because a cached read
 * bills at about a tenth of the input rate while a write costs 1.25x.
 */

// Real sizes as shipped, in characters (migration 0156).
const ARTICLE_PROMPT_CHARS = 7386; // ~1783 tokens
const REWRITE_PROMPT_CHARS = 6910; // ~1668 tokens
const CATEGORIZE_PROMPT_CHARS = 5293; // ~1278 tokens
const FOLLOWUP_PROMPT_CHARS = 1437;
const TRIAGE_PROMPT_CHARS = 520;

const prompt = (chars: number) => "x".repeat(chars);

describe("shouldCacheSystemPrompt", () => {
  it("caches the article and rewrite prompts on Sonnet 4.6", () => {
    // The two that matter: 290 calls over 30 days, the same prompt every time.
    expect(
      shouldCacheSystemPrompt("claude-sonnet-4-6", prompt(ARTICLE_PROMPT_CHARS)),
    ).toBe(true);
    expect(
      shouldCacheSystemPrompt("claude-sonnet-4-6", prompt(REWRITE_PROMPT_CHARS)),
    ).toBe(true);
  });

  it("leaves the Haiku prompts alone", () => {
    // Haiku 4.5 will not cache below 4096 tokens, and none of these come close.
    // Marking them would be inert rather than harmful, but the honest signal is
    // that these stages are not caching.
    for (const chars of [
      CATEGORIZE_PROMPT_CHARS,
      FOLLOWUP_PROMPT_CHARS,
      TRIAGE_PROMPT_CHARS,
    ]) {
      expect(shouldCacheSystemPrompt("claude-haiku-4-5", prompt(chars))).toBe(
        false,
      );
    }
  });

  it("reads the threshold per model, not by generation", () => {
    // The same prompt caches on Sonnet 4.6 and not on Haiku 4.5, and the newer
    // Opus 5 threshold is LOWER than Opus 4.6's. Nothing here can be inferred
    // from the model name, which is why the table is explicit.
    const midSized = prompt(9000); // ~2000 tokens
    expect(shouldCacheSystemPrompt("claude-sonnet-4-6", midSized)).toBe(true);
    expect(shouldCacheSystemPrompt("claude-haiku-4-5", midSized)).toBe(false);
    expect(shouldCacheSystemPrompt("claude-opus-5", midSized)).toBe(true);
    expect(shouldCacheSystemPrompt("claude-opus-4-6", midSized)).toBe(false);
  });

  it("under-counts tokens so a borderline prompt is never over-claimed", () => {
    // Sonnet's floor is 1024 tokens. At the real ~4.14 chars/token these
    // prompts measure, 4300 chars is about 1039 tokens: over the line, but too
    // close to trust an estimate, so the conservative divisor keeps it off.
    expect(shouldCacheSystemPrompt("claude-sonnet-4-6", prompt(4300))).toBe(
      false,
    );
    expect(shouldCacheSystemPrompt("claude-sonnet-4-6", prompt(4700))).toBe(
      true,
    );
  });

  it("assumes the common threshold for an unrecognized model", () => {
    // modelArticle is a DB setting, so it can name a model this table predates.
    // Falling back to 1024 keeps caching working on the next Sonnet-tier model
    // without a code change.
    expect(shouldCacheSystemPrompt("claude-future-9", prompt(9000))).toBe(true);
    expect(shouldCacheSystemPrompt("claude-future-9", prompt(500))).toBe(false);
  });

  it("never marks an empty or trivial prompt", () => {
    expect(shouldCacheSystemPrompt("claude-sonnet-4-6", "")).toBe(false);
    expect(shouldCacheSystemPrompt("claude-sonnet-4-6", "Be brief.")).toBe(
      false,
    );
  });
});
