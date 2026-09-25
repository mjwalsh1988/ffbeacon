/**
 * FF Beacon's own lint rules: the house rules in CLAUDE.md that a machine can
 * check, so they fail `npm run lint` instead of waiting for a reviewer.
 *
 *   ascii-punctuation  CLAUDE.md rule 6. No em or en dash, curly quote or
 *                      apostrophe, ellipsis character, middle dot, bullet or
 *                      non-breaking space ANYWHERE in a source file: strings,
 *                      JSX text and comments alike. Code that has to detect
 *                      one of them writes it as an escape ("\u2014"), which
 *                      means the same thing to JavaScript and keeps the file
 *                      plain ASCII.
 *   sleeper-api-host   "All Sleeper endpoints live in lib/sleeper.ts." A string
 *                      naming api.sleeper.app or api.sleeper.com anywhere else
 *                      is a direct call waiting to happen. Comments are fine.
 *   eastern-time       The Time Display rule. A date formatter must name its
 *                      zone: toLocaleDateString, toLocaleTimeString,
 *                      toLocaleString on a `new Date(...)`, and
 *                      `new Intl.DateTimeFormat(...)` need an options object
 *                      with a `timeZone` key (SITE_TIME_ZONE, from
 *                      lib/datetime.ts). Without one, a server render uses UTC
 *                      and a client render uses the reader's zone.
 *
 * Tested in ffbeacon-plugin.test.ts with ESLint's RuleTester.
 */

// The banned characters, each named for the message. Written as escapes on
// purpose: this file obeys its own rule.
const BANNED = new Map([
  ["\u2014", "an em dash"],
  ["\u2013", "an en dash"],
  ["\u2018", "a curly opening apostrophe"],
  ["\u2019", "a curly apostrophe"],
  ["\u201C", "a curly opening quote"],
  ["\u201D", "a curly closing quote"],
  ["\u2026", "an ellipsis character"],
  ["\u00B7", "a middle dot"],
  ["\u2022", "a bullet character"],
  ["\u00A0", "a non-breaking space"],
]);
const BANNED_PATTERN = new RegExp(`[${[...BANNED.keys()].join("")}]`, "g");

const asciiPunctuation = {
  meta: {
    type: "problem",
    docs: { description: "Forbid typographic punctuation that reads as AI-written (CLAUDE.md rule 6)." },
    schema: [],
    messages: {
      banned:
        "{{name}} in source. Use plain ASCII punctuation; to detect the character, write it as an escape ({{escape}}).",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    return {
      Program() {
        const text = sourceCode.text;
        BANNED_PATTERN.lastIndex = 0;
        for (let match = BANNED_PATTERN.exec(text); match; match = BANNED_PATTERN.exec(text)) {
          const char = match[0];
          const start = sourceCode.getLocFromIndex(match.index);
          const end = sourceCode.getLocFromIndex(match.index + 1);
          context.report({
            loc: { start, end },
            messageId: "banned",
            data: {
              name: BANNED.get(char).replace(/^./, (c) => c.toUpperCase()),
              escape: `\\u${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`,
            },
          });
        }
      },
    };
  },
};

const SLEEPER_HOST = /api\.sleeper\.(app|com)/;

const sleeperApiHost = {
  meta: {
    type: "problem",
    docs: { description: "Sleeper endpoints live in lib/sleeper.ts only." },
    schema: [],
    messages: {
      direct:
        "Sleeper API host in code outside lib/sleeper.ts. Add the endpoint to lib/sleeper.ts as an exported function and call that.",
    },
  },
  create(context) {
    const check = (node, value) => {
      if (typeof value === "string" && SLEEPER_HOST.test(value)) {
        context.report({ node, messageId: "direct" });
      }
    };
    return {
      Literal(node) {
        check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.raw);
      },
    };
  },
};

const DATE_ONLY_METHODS = new Set(["toLocaleDateString", "toLocaleTimeString"]);

/** True when an options argument visibly carries a timeZone, or cannot be read. */
function namesTimeZone(options) {
  if (!options) return false;
  // A variable, a call or a conditional: the options come from somewhere this
  // rule cannot see into, so it stays quiet rather than guessing.
  if (options.type !== "ObjectExpression") return true;
  return options.properties.some(
    (p) =>
      p.type === "SpreadElement" ||
      (p.type === "Property" &&
        ((p.key.type === "Identifier" && p.key.name === "timeZone") ||
          (p.key.type === "Literal" && p.key.value === "timeZone"))),
  );
}

function isNewDate(node) {
  return node && node.type === "NewExpression" && node.callee.type === "Identifier" && node.callee.name === "Date";
}

const easternTime = {
  meta: {
    type: "problem",
    docs: { description: "Every displayed date names its zone (CLAUDE.md Time Display)." },
    schema: [],
    messages: {
      missing:
        "Date formatting without a timeZone. Pass timeZone: SITE_TIME_ZONE (lib/datetime.ts), or use formatEastern and its siblings.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || callee.property.type !== "Identifier") return;
        const method = callee.property.name;
        const applies =
          DATE_ONLY_METHODS.has(method) || (method === "toLocaleString" && isNewDate(callee.object));
        if (!applies) return;
        if (!namesTimeZone(node.arguments[1])) context.report({ node, messageId: "missing" });
      },
      NewExpression(node) {
        const callee = node.callee;
        const isDateTimeFormat =
          callee.type === "MemberExpression" &&
          callee.object.type === "Identifier" &&
          callee.object.name === "Intl" &&
          callee.property.type === "Identifier" &&
          callee.property.name === "DateTimeFormat";
        if (!isDateTimeFormat) return;
        if (!namesTimeZone(node.arguments[1])) context.report({ node, messageId: "missing" });
      },
    };
  },
};

const plugin = {
  meta: { name: "eslint-plugin-ffbeacon" },
  rules: {
    "ascii-punctuation": asciiPunctuation,
    "sleeper-api-host": sleeperApiHost,
    "eastern-time": easternTime,
  },
};

export default plugin;
