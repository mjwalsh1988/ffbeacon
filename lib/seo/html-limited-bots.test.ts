import { describe, expect, it } from "vitest";
import { HTML_LIMITED_BOT_UA_RE } from "next/dist/shared/lib/router/utils/html-bots";
import {
  HTML_LIMITED_BOTS,
  NEXT_DEFAULT_HTML_LIMITED_BOTS,
} from "./html-limited-bots";

// Real user agent strings, as each vendor documents them.
const MUST_MATCH: Array<[string, string]> = [
  ["Googlebot desktop", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"],
  [
    "Googlebot smartphone",
    "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.126 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  ],
  ["Google-InspectionTool", "Mozilla/5.0 (compatible; Google-InspectionTool/1.0;)"],
  ["Bingbot", "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)"],
  [
    "OAI-SearchBot",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot",
  ],
  [
    "ChatGPT-User",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
  ],
  [
    "GPTBot",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot",
  ],
  [
    "ClaudeBot",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  ],
  ["Claude-SearchBot", "Mozilla/5.0 (compatible; Claude-SearchBot/1.0; +https://www.anthropic.com)"],
  [
    "PerplexityBot",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
  ],
  ["Twitterbot", "Twitterbot/1.0"],
  ["Discordbot", "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)"],
];

const MUST_NOT_MATCH: Array<[string, string]> = [
  [
    "Chrome on Windows",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  ],
  [
    "Safari on iPhone",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  ],
  [
    "Firefox on Android",
    "Mozilla/5.0 (Android 14; Mobile; rv:129.0) Gecko/129.0 Firefox/129.0",
  ],
];

describe("HTML_LIMITED_BOTS", () => {
  // htmlLimitedBots REPLACES Next's default. If a Next upgrade adds a bot to
  // its list, this fails until the copy in html-limited-bots.ts is updated,
  // rather than the new bot silently getting streamed metadata.
  it("carries Next's default list verbatim", () => {
    expect(NEXT_DEFAULT_HTML_LIMITED_BOTS).toBe(HTML_LIMITED_BOT_UA_RE.source);
    expect(HTML_LIMITED_BOTS.source).toContain(HTML_LIMITED_BOT_UA_RE.source);
    expect(HTML_LIMITED_BOTS.flags).toContain("i");
  });

  it.each(MUST_MATCH)("matches %s", (_name, ua) => {
    expect(HTML_LIMITED_BOTS.test(ua)).toBe(true);
  });

  it.each(MUST_NOT_MATCH)("does not match %s", (_name, ua) => {
    expect(HTML_LIMITED_BOTS.test(ua)).toBe(false);
  });
});
