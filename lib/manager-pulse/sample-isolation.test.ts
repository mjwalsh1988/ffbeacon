/**
 * The sample-fixture isolation guard.
 *
 * lib/manager-pulse/sample.ts holds SAMPLE_MANAGER_REPORT: invented numbers,
 * placeholder players, a placeholder handle, all built to render the guest
 * view of /tools/manager-pulse before anyone types a real Sleeper handle. It
 * is the ONLY place in this feature where a fabricated figure is allowed to
 * sit on a page that otherwise promises every number is checkable against a
 * real capture.
 *
 * That promise only holds if the fixture cannot leak. This test scans every
 * source file under lib/manager-pulse, components/manager-pulse and
 * app/tools/manager-pulse for an import of ./sample (or
 * @/lib/manager-pulse/sample), and fails the build if anything imports it
 * other than components/manager-pulse/sample-report.tsx (the guest view,
 * which is what section 7.3 of docs/manager-pulse/manager-pulse-plan.md asks for) and this
 * file's own sanity check below. If a real read path ever imports this
 * module, a fabricated number reaches a page about a real person, which is
 * exactly the failure this guard exists to catch before it ships.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const SKIP_DIRECTORIES = new Set(["node_modules", ".next", ".git", "dist", "build"]);

/** Directories scanned for a stray import. Relative to the repo root. */
const SCAN_DIRS = [
  "lib/manager-pulse",
  "components/manager-pulse",
  "app/tools/manager-pulse",
];

/** The only files allowed to import the fixture. Relative to the repo root, forward slashes. */
const ALLOWED_IMPORTERS = new Set([
  "components/manager-pulse/sample-report.tsx",
  "lib/manager-pulse/sample-isolation.test.ts",
]);

/** sample.ts itself never counts as importing itself. */
const SAMPLE_FILE = "lib/manager-pulse/sample.ts";

function walk(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  let entries: string[];
  try {
    entries = readdirSync(abs);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const rel = path.posix.join(dir.split(path.sep).join("/"), entry);
    const full = path.join(ROOT, rel);
    if (statSync(full).isDirectory()) out.push(...walk(rel));
    else if (SOURCE_EXTENSIONS.has(path.extname(entry))) out.push(rel);
  }
  return out;
}

/**
 * Every import/require specifier in `content` that resolves to
 * lib/manager-pulse/sample (extension-less), from a file at `relFile`.
 *
 * Handles `import ... from "..."`, `import("...")`, and `require("...")`,
 * and resolves both relative specifiers (against the importing file's own
 * directory) and the `@/` alias (against the repo root), so a match holds
 * regardless of how deep the importer sits.
 */
export function importsSampleFixture(relFile: string, content: string): boolean {
  const pattern = /(?:from\s+|import\s*\(|require\s*\()\s*["']([^"']+)["']/g;
  const importerDir = path.posix.dirname(relFile.split(path.sep).join("/"));
  const target = "lib/manager-pulse/sample";

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const specifier = match[1];
    let resolved: string | null = null;

    if (specifier.startsWith("@/")) {
      resolved = specifier.slice(2);
    } else if (specifier.startsWith(".")) {
      resolved = path.posix.normalize(path.posix.join(importerDir, specifier));
    } else {
      continue; // a package import, never this fixture
    }

    resolved = resolved.replace(/\.(ts|tsx|js|jsx)$/, "");
    if (resolved === target) return true;
  }
  return false;
}

function describeViolations(files: string[]): string {
  if (files.length === 0) return "";
  return (
    `${files.join("\n")}\n\n` +
    `Found ${files.length} file(s) importing lib/manager-pulse/sample outside the ` +
    `allowed list (components/manager-pulse/sample-report.tsx and this test). ` +
    `SAMPLE_MANAGER_REPORT is invented data for the guest view only. A real ` +
    `read path must never import it: remove the import and read the real ` +
    `report service instead.`
  );
}

describe("the Manager Pulse sample fixture cannot leak into a real read path", () => {
  it("finds no importer of lib/manager-pulse/sample outside the allowed list", () => {
    const files = SCAN_DIRS.flatMap(walk).filter((f) => f !== SAMPLE_FILE);

    const violators = files.filter((f) => {
      if (ALLOWED_IMPORTERS.has(f)) return false;
      const content = readFileSync(path.join(ROOT, f), "utf8");
      return importsSampleFixture(f, content);
    });

    expect(describeViolations(violators)).toBe("");
  });

  it("the allowed importer actually exists and actually imports the fixture, once that file lands", () => {
    // sample-report.tsx is built alongside this test in the same task, so by
    // the time this suite runs it should already import the fixture. If it
    // does not exist yet, this check is a no-op rather than a failure: the
    // isolation guard's job is to catch a LEAK, not to enforce build order
    // against other agents' files.
    const reportPath = path.join(ROOT, "components/manager-pulse/sample-report.tsx");
    let content: string;
    try {
      content = readFileSync(reportPath, "utf8");
    } catch {
      return;
    }
    expect(importsSampleFixture("components/manager-pulse/sample-report.tsx", content)).toBe(
      true,
    );
  });
});

describe("the guard itself works", () => {
  it("flags a relative import from a sibling file", () => {
    expect(
      importsSampleFixture(
        "lib/manager-pulse/capture.ts",
        'import { SAMPLE_MANAGER_REPORT } from "./sample";',
      ),
    ).toBe(true);
  });

  it("flags an @/ alias import from a deeper file", () => {
    expect(
      importsSampleFixture(
        "components/manager-pulse/results-panel.tsx",
        'import { SAMPLE_MANAGER_REPORT } from "@/lib/manager-pulse/sample";',
      ),
    ).toBe(true);
  });

  it("flags a dynamic import", () => {
    expect(
      importsSampleFixture(
        "app/tools/manager-pulse/page.tsx",
        'const mod = await import("@/lib/manager-pulse/sample");',
      ),
    ).toBe(true);
  });

  it("ignores an import of a differently-named sibling module", () => {
    expect(
      importsSampleFixture(
        "lib/manager-pulse/load.ts",
        'import { settings } from "./settings";\nimport type { ManagerReport } from "./types";',
      ),
    ).toBe(false);
  });

  it("ignores a package import that merely contains the word sample", () => {
    expect(
      importsSampleFixture(
        "lib/manager-pulse/load.ts",
        'import { sample } from "sample-package";',
      ),
    ).toBe(false);
  });

  it("does not confuse sample-report.tsx or sample-isolation.test.ts with sample.ts itself", () => {
    expect(
      importsSampleFixture(
        "lib/manager-pulse/sample-isolation.test.ts",
        'import { importsSampleFixture } from "./sample-isolation";',
      ),
    ).toBe(false);
  });
});
