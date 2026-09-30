import "server-only";

/**
 * The service-role client, behind the `server-only` guard.
 *
 * Import `createAdminClient` from HERE in app code. A client component that
 * reaches this module, directly or through anything it imports, fails the
 * build rather than shipping a code path that expects SUPABASE_SECRET_KEY.
 *
 * WHY lib/supabase/server.ts IS NOT GUARDED ITSELF
 *   The guard throws under plain Node, and the npm scripts run under plain
 *   `tsx` (no react-server condition). They reach lib/supabase/server.ts
 *   through shared lib modules such as lib/league-pulse.ts, so guarding that
 *   file would stop `npm run pulse:league`, `sync:ktc` and the other sync and
 *   calculate scripts from starting. server.ts is still kept out of client
 *   bundles by its own `next/headers` import, which Next refuses in a client
 *   component, and the secret key has no NEXT_PUBLIC_ prefix, so it is never
 *   inlined into browser code. This module is the explicit guard on top.
 */
export { createAdminClient } from "@/lib/supabase/server";
