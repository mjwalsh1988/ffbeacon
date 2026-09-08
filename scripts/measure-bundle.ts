// Bundle size report (Phase 0, PERF-T002 in
// docs/performance/site-speed-audit-and-plan.md).
//
// Reads .next/app-build-manifest.json after a production build and reports,
// per route, how much JavaScript a reader downloads: raw bytes and gzip
// bytes (gzip is what actually crosses the wire; raw is the number a
// bundle analyzer usually quotes, so both are printed side by side). Most
// routes share the same handful of chunks (framework, the Next.js runtime,
// the root layout's client bundle), so every chunk's size is computed once
// into a cache and looked up by every route that references it. Without
// the cache this script gzips the same 185 kB framework chunk once per
// route instead of once total, which turns a few seconds of work into
// minutes on a site with this many routes.
//
// Run after "next build":
//   npm run measure:bundle
//
// Prints to stdout and writes the same text to
// docs/performance/bundle-<date>.txt (date in America/New_York, per the
// project's Time Display rule) so a before and after change in bundle size
// can be diffed in git.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const MANIFEST_PATH = join(".next", "app-build-manifest.json");

type AppBuildManifest = {
  pages: Record<string, string[]>;
};

type ChunkSize = { raw: number; gz: number };

type RouteRow = { route: string; raw: number; gz: number };

type ChunkRow = { file: string; raw: number; gz: number };

/** Reads and gzips one chunk file relative to .next/, memoized in `cache` so
 * a chunk shared by many routes (framework, main, the layout bundle) is
 * read and gzipped exactly once no matter how many routes reference it. */
function sizeOfChunk(file: string, cache: Map<string, ChunkSize>): ChunkSize {
  const cached = cache.get(file);
  if (cached) return cached;
  const buf = readFileSync(join(".next", file));
  const size: ChunkSize = { raw: buf.length, gz: gzipSync(buf).length };
  cache.set(file, size);
  return size;
}

function kb(bytes: number): string {
  return (bytes / 1024).toFixed(0);
}

/** Pure formatting: turns route rows and chunk rows into the printable
 * report. Kept separate from the filesystem reads above so the shape of the
 * output can be checked without touching disk. */
function formatReport(routeRows: RouteRow[], chunkRows: ChunkRow[]): string {
  const lines: string[] = [];

  lines.push("Route | Raw kB | Gzip kB");
  lines.push("--- | --- | ---");
  for (const row of routeRows) {
    lines.push(`${row.route} | ${kb(row.raw)} | ${kb(row.gz)}`);
  }

  lines.push("");
  lines.push("Ten largest chunks:");
  lines.push("Chunk | Raw kB | Gzip kB");
  lines.push("--- | --- | ---");
  for (const chunk of chunkRows) {
    lines.push(`${chunk.file} | ${kb(chunk.raw)} | ${kb(chunk.gz)}`);
  }

  return lines.join("\n");
}

function loadManifest(): AppBuildManifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as AppBuildManifest;
}

function buildRows(manifest: AppBuildManifest): { routeRows: RouteRow[]; chunkRows: ChunkRow[] } {
  const cache = new Map<string, ChunkSize>();

  const routeRows: RouteRow[] = Object.entries(manifest.pages).map(([route, files]) => {
    const sizes = files.filter((f) => f.endsWith(".js")).map((f) => sizeOfChunk(f, cache));
    return {
      route,
      raw: sizes.reduce((sum, s) => sum + s.raw, 0),
      gz: sizes.reduce((sum, s) => sum + s.gz, 0),
    };
  });
  routeRows.sort((a, b) => b.raw - a.raw);

  // The cache is fully populated by the loop above, so reading it back here
  // gives every distinct chunk exactly once, already sized.
  const chunkRows: ChunkRow[] = [...cache.entries()]
    .map(([file, size]) => ({ file, raw: size.raw, gz: size.gz }))
    .sort((a, b) => b.raw - a.raw)
    .slice(0, 10);

  return { routeRows, chunkRows };
}

/** en-CA renders as YYYY-MM-DD directly, which is what a filename wants.
 * Per the project's Time Display rule: display timestamps always resolve
 * through an explicit America/New_York zone, never the server's UTC clock
 * or a bare toLocaleDateString call. */
function easternDateStamp(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function main(): void {
  if (!existsSync(MANIFEST_PATH)) {
    console.error(
      `Bundle report: ${MANIFEST_PATH} does not exist. Run "next build" first, then re-run "npm run measure:bundle".`,
    );
    process.exit(1);
  }

  const { routeRows, chunkRows } = buildRows(loadManifest());
  const report = formatReport(routeRows, chunkRows);
  console.log(report);

  const outDir = join("docs", "performance");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `bundle-${easternDateStamp()}.txt`);
  writeFileSync(outPath, `${report}\n`, "utf8");
  console.log("");
  console.log(`Bundle report written to ${outPath}`);
}

main();
