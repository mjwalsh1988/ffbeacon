/**
 * The weather host guard.
 *
 * lib/nfl-weather.ts is the only file allowed to name the National Weather
 * Service API host or MET Norway's, the same rule lib/sleeper.ts holds for
 * Sleeper. Both providers identify a caller by User-Agent and both act on it:
 * MET Norway answers an unidentified client with 403 and blocks one that keeps
 * trying. A second call site somewhere else would have to rebuild that header,
 * the timeout, the single retry and the null-on-failure contract, and the one
 * that gets any of them wrong is the one that gets the site's address refused.
 *
 * So this walks app/, lib/, components/ and scripts/ and fails on either host
 * in any file but the adapter, its own tests and its saved responses. Unlike
 * the Sleeper lint rule it reads comments too: a comment carrying the URL is
 * where the next direct call gets pasted from.
 *
 * IF THIS TEST JUST FAILED ON YOUR CHANGE: add the request to lib/nfl-weather.ts
 * as an exported function and call that. For a link or a credit, import
 * MET_NORWAY_ATTRIBUTION_URL or NWS_ATTRIBUTION_URL from it.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");

const WALKED = ["app", "lib", "components", "scripts"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"]);
const SKIP_DIRECTORIES = new Set(["node_modules", ".next", ".git", "dist", "build"]);

/** Assembled from parts, so this file does not name them and needs no exception of its own. */
const HOSTS = [["api", "weather", "gov"].join("."), ["api", "met", "no"].join(".")];

/** The adapter, the tests that feed it a URL, and the responses saved from the providers. */
const ALLOWED_FILES = new Set(["lib/nfl-weather.ts", "lib/nfl-weather.test.ts"]);
const ALLOWED_DIRECTORY = "lib/__fixtures__/nfl-weather/";

function walk(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(path.join(ROOT, dir));
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const rel = `${dir}/${entry}`;
    if (statSync(path.join(ROOT, rel)).isDirectory()) out.push(...walk(rel));
    else if (SOURCE_EXTENSIONS.has(path.extname(entry))) out.push(rel);
  }
  return out;
}

/** Every line of `content` naming a weather host, as "file:line  text". */
export function weatherHostLinesIn(file: string, content: string): string[] {
  const out: string[] = [];
  content.split(/\r?\n/).forEach((line, index) => {
    if (HOSTS.some((host) => line.includes(host))) {
      out.push(`${file}:${index + 1}  ${line.trim().slice(0, 140)}`);
    }
  });
  return out;
}

function isAllowed(file: string): boolean {
  return ALLOWED_FILES.has(file) || file.startsWith(ALLOWED_DIRECTORY);
}

describe("the weather hosts are named in one file", () => {
  it("finds neither host outside lib/nfl-weather.ts, its tests and its fixtures", () => {
    const violations = WALKED.flatMap(walk)
      .filter((file) => !isAllowed(file))
      .flatMap((file) => weatherHostLinesIn(file, readFileSync(path.join(ROOT, file), "utf8")));

    expect(
      violations.length === 0
        ? ""
        : `${violations.join("\n")}\n\nA weather provider host is named outside lib/nfl-weather.ts. ` +
            `Add the request to that file and call it, or import its attribution constants for a link.`,
    ).toBe("");
  });

  it("walks a tree that actually holds the adapter", () => {
    // A guard that walks nothing passes forever.
    const files = WALKED.flatMap(walk);
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain("lib/nfl-weather.ts");
    expect(files).toContain("app/api/cron/sync-nfl-weather/route.ts");
    expect(files.some((file) => file.startsWith(ALLOWED_DIRECTORY))).toBe(true);
  });

  it("the adapter still names both hosts, so the allowance is not stale", () => {
    const adapter = readFileSync(path.join(ROOT, "lib", "nfl-weather.ts"), "utf8");
    for (const host of HOSTS) expect(adapter).toContain(host);
  });
});

describe("the guard itself works", () => {
  it("flags a string, a template and a comment alike", () => {
    const content = [
      `const a = "https://${HOSTS[0]}/points/1,2";`,
      "const ok = 1;",
      `// see https://${HOSTS[1]}/weatherapi`,
    ].join("\n");
    const found = weatherHostLinesIn("fake.ts", content);
    expect(found).toHaveLength(2);
    expect(found[0].startsWith("fake.ts:1")).toBe(true);
    expect(found[1].startsWith("fake.ts:3")).toBe(true);
  });

  it("does not flag the public sites a credit links to", () => {
    expect(weatherHostLinesIn("fake.tsx", 'href="https://www.weather.gov/"')).toEqual([]);
    expect(weatherHostLinesIn("fake.tsx", 'href="https://www.met.no/en"')).toEqual([]);
  });

  it("allows only the adapter, its test and its fixtures", () => {
    expect(isAllowed("lib/nfl-weather.ts")).toBe(true);
    expect(isAllowed("lib/nfl-weather.test.ts")).toBe(true);
    expect(isAllowed("lib/__fixtures__/nfl-weather/nws-points.json")).toBe(true);
    expect(isAllowed("lib/sync-nfl-weather.ts")).toBe(false);
    expect(isAllowed("app/terms/page.tsx")).toBe(false);
    expect(isAllowed("scripts/sync-nfl-weather.ts")).toBe(false);
  });
});
