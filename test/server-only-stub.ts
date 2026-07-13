// Test stub for the Next.js-provided "server-only" module, which is not resolvable
// under Vitest (Next injects it at build time). Aliased in vitest.config.ts so that
// modules guarding themselves with `import "server-only"` (e.g. lib/client-ip.ts,
// lib/cron-auth.ts) can be imported and unit-tested. The guard still applies in the
// real Next build; this only affects test resolution.
export {};
