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
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "app/**/*.test.ts"],
    globals: false,
  },
});
