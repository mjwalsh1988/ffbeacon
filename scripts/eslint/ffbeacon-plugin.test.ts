import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import plugin from "./ffbeacon-plugin.mjs";

// RuleTester reports through the test framework's describe and it.
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

// Built from code points so this file stays plain ASCII, the rule under test.
const EM_DASH = String.fromCharCode(0x2014);
const CURLY = String.fromCharCode(0x2019);
const NBSP = String.fromCharCode(0x00a0);
const BACKSLASH = String.fromCharCode(92);

tester.run("ascii-punctuation", plugin.rules["ascii-punctuation"], {
  valid: [
    { code: 'const a = "plain, ASCII: fine.";' },
    // The escape is six ASCII characters and is how code detects the dash.
    { code: `const banned = /[${BACKSLASH}u2014]/;` },
  ],
  invalid: [
    { code: `const a = "one ${EM_DASH} two";`, errors: [{ messageId: "banned" }] },
    { code: `// it${CURLY}s in a comment too`, errors: [{ messageId: "banned" }] },
    { code: `const el = <p>a${NBSP}b</p>;`, errors: [{ messageId: "banned" }] },
    {
      code: `const t = \`${EM_DASH}${CURLY}\`;`,
      errors: [{ messageId: "banned" }, { messageId: "banned" }],
    },
  ],
});

tester.run("sleeper-api-host", plugin.rules["sleeper-api-host"], {
  valid: [
    { code: "// see api.sleeper.app/v1 for the shape\nconst a = 1;" },
    { code: 'const url = "https://example.com/v1";' },
  ],
  invalid: [
    { code: 'fetch("https://api.sleeper.app/v1/state/nfl");', errors: [{ messageId: "direct" }] },
    { code: "const u = `https://api.sleeper.com/stats/nfl/${1}`;", errors: [{ messageId: "direct" }] },
  ],
});

tester.run("eastern-time", plugin.rules["eastern-time"], {
  valid: [
    { code: 'd.toLocaleDateString("en-US", { timeZone: SITE_TIME_ZONE, month: "short" });' },
    { code: 'new Intl.DateTimeFormat("en-US", { timeZone: SITE_TIME_ZONE, hour: "numeric" });' },
    // Options built elsewhere cannot be read here; the rule stays quiet.
    { code: 'new Intl.DateTimeFormat("en-US", OPTIONS);' },
    { code: 'd.toLocaleDateString("en-US", { ...EASTERN, month: "short" });' },
    // Number formatting is not a date.
    { code: 'n.toLocaleString("en-US");' },
  ],
  invalid: [
    { code: "d.toLocaleDateString();", errors: [{ messageId: "missing" }] },
    { code: 'd.toLocaleTimeString("en-US", { hour: "numeric" });', errors: [{ messageId: "missing" }] },
    { code: "new Date(iso).toLocaleString();", errors: [{ messageId: "missing" }] },
    { code: 'new Intl.DateTimeFormat("en-US", { month: "short" });', errors: [{ messageId: "missing" }] },
  ],
});
