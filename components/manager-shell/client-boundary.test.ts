/**
 * A server component must never import a value from a "use client" module.
 *
 * WHY THIS TEST EXISTS
 * The Manager Pulse report page shipped with its five pure lens helpers
 * (`underLens`, `perTypeUnderLens`, `perTypeSlice`, `defaultLens`, `lensLabel`)
 * exported from `lens-switch.tsx`, which carries "use client". Next turns every
 * export of a client module into a client reference in the react-server layer,
 * so the six SERVER components that called them got a proxy that throws:
 *
 *   Attempted to call underLens() from the server but underLens is on the client
 *
 * The report page and the signed-out sample page both returned a 500. Every
 * unit test passed the whole time, because a unit test imports the module
 * directly and never crosses the boundary that breaks it. `tsc` passed too: the
 * types are perfectly correct, and the failure is a runtime property of how the
 * bundler splits the graph.
 *
 * So the check has to be structural. This walks the Manager Pulse source, finds
 * every module that declares "use client", and asserts that no file WITHOUT
 * that directive imports a runtime binding from one. Type-only imports are
 * fine: they are erased before the bundler ever sees them.
 *
 * WHAT IS AND IS NOT A VIOLATION
 * A server component RENDERING a client component is the normal, correct
 * pattern and the whole point of the boundary: `<ManagerSearchForm />` from a
 * server page is fine, because Next serializes the reference and the browser
 * does the calling. What breaks is a server component CALLING a plain function
 * that lives in a client module, because there is nothing to serialize and the
 * proxy throws.
 *
 * The two are told apart by React's own naming convention: a PascalCase import
 * is a component and is allowed, a camelCase import is a value being called and
 * is not. That is a heuristic rather than a proof, and it is the right one here
 * because the convention is enforced by React itself (a lowercase JSX tag is
 * treated as a DOM element, so a component cannot be camelCase and work).
 *
 * The lesson worth keeping: being free of React and of fetch is not what makes
 * a function server-safe. Not living in a client module is.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

/** Directories whose files may sit on either side of the boundary. */
const DIRS = [
  "components/manager-shell",
  "components/manager-pulse",
  "app/tools/manager-pulse",
];

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
    const rel = path.join(dir, entry);
    const full = path.join(ROOT, rel);
    if (statSync(full).isDirectory()) {
      out.push(...walk(rel));
      continue;
    }
    if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      out.push(rel.split(path.sep).join("/"));
    }
  }
  return out;
}

function isClientModule(source: string): boolean {
  // The directive has to be the first statement, so checking the head is enough
  // and avoids matching the word inside a comment further down.
  return /^\s*(?:\/\*[\s\S]*?\*\/\s*)?["']use client["']/.test(source);
}

/**
 * Every import in `source` that brings in a RUNTIME binding, as
 * [specifier, clause] pairs. `import type` and `type` members are skipped: they
 * are erased at compile time and cannot become a client reference.
 */
function runtimeImports(source: string): Array<{ specifier: string; clause: string }> {
  const out: Array<{ specifier: string; clause: string }> = [];
  const re = /import\s+([\s\S]*?)\s+from\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const clause = m[1];
    const specifier = m[2];
    if (/^\s*type\b/.test(clause)) continue; // import type { ... }
    // A clause whose every named member is `type X` is also erased.
    const named = clause.match(/\{([\s\S]*)\}/);
    if (named && !/^\s*\w/.test(clause.trim())) {
      const members = named[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (members.length > 0 && members.every((mem) => /^type\s/.test(mem))) continue;
    }
    out.push({ specifier, clause });
  }
  return out;
}

/** Resolve a relative or "@/"-rooted specifier to a repo-relative source file. */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) {
    base = specifier.slice(2);
  } else if (specifier.startsWith(".")) {
    base = path.join(path.dirname(fromFile), specifier).split(path.sep).join("/");
  } else {
    return null; // a package, not our source
  }
  for (const candidate of [`${base}.tsx`, `${base}.ts`, `${base}/index.ts`, `${base}/index.tsx`]) {
    try {
      if (statSync(path.join(ROOT, candidate)).isFile()) return candidate;
    } catch {
      // keep trying
    }
  }
  return null;
}

describe("no server component imports a runtime value from a client module", () => {
  it("holds across every Manager Pulse surface", () => {
    const files = DIRS.flatMap(walk).filter(
      (f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"),
    );

    const sources = new Map<string, string>();
    for (const f of files) sources.set(f, readFileSync(path.join(ROOT, f), "utf8"));

    const violations: string[] = [];
    for (const [file, source] of sources) {
      if (isClientModule(source)) continue; // a client module may import another
      for (const { specifier, clause } of runtimeImports(source)) {
        const target = resolveSpecifier(file, specifier);
        if (!target) continue;
        const targetSource = sources.get(target) ?? safeRead(target);
        if (!targetSource || !isClientModule(targetSource)) continue;
        // Only NON-component imports are a problem. See the header: a server
        // component may render a client component, it may not call a client
        // module's function.
        const called = namedMembers(clause).filter((name) => !/^[A-Z]/.test(name));
        if (called.length === 0) continue;
        violations.push(
          `${file} calls ${called.join(", ")} from "${specifier}" (${target}), which is a "use client" module`,
        );
      }
    }

    expect(
      violations,
      "A server component is calling a function that lives in a client module. " +
        "Next turns every export of a \"use client\" file into a client reference, " +
        "so the call throws at render even though tsc and the unit tests pass. " +
        "Move the shared value into a module with no directive and import it from both sides:\n" +
        violations.join("\n"),
    ).toEqual([]);
  });
});

/**
 * The named members of an import clause, ignoring a default or namespace import
 * (neither can be a bare function this codebase calls across the boundary) and
 * ignoring `type` members, which are erased.
 */
function namedMembers(clause: string): string[] {
  const named = clause.match(/\{([\s\S]*)\}/);
  if (!named) return [];
  return named[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !/^type\s/.test(s))
    .map((s) => s.split(/\s+as\s+/)[0].trim())
    .filter(Boolean);
}

function safeRead(rel: string): string | null {
  try {
    return readFileSync(path.join(ROOT, rel), "utf8");
  } catch {
    return null;
  }
}
