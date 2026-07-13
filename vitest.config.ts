import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Vitest configuration for FF Beacon unit tests. The first suite is the Signal
// Check value/rules engine (lib/signal-check). Tests are colocated as
// *.test.ts next to the modules they cover. The "@/..." alias mirrors the
// tsconfig path mapping so test imports resolve the same way the app does.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // "server-only" is provided by Next at build time and is not resolvable under
      // Vitest. Stub it so modules that guard with `import "server-only"` can be
      // imported in unit tests. The guard still applies in the real Next build.
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
    },
  },
  // tsconfig.json sets jsx: "preserve" for Next.js, which vitest's transform
  // pipeline (oxc in this vitest version) will not compile, so any test
  // importing a .tsx module (for a non-JSX export like aggregateSeasons in
  // components/player-profile/stat-shaping.tsx) would fail at the
  // import-analysis step. Overriding to the automatic runtime here only
  // affects how vitest transforms sources; the Next build is untouched.
  oxc: {
    jsx: {
      runtime: "automatic",
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "app/**/*.test.ts"],
    globals: false,
  },
});
