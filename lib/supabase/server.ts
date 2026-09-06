import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { cache } from "react";
import type { Database } from "@/lib/database.types";

/**
 * The request-scoped session client.
 *
 * Wrapped in React `cache()` so one render shares ONE instance. That is not a
 * micro-optimisation: every `createServerClient` builds its own GoTrueClient,
 * and `auth.getUser()` on a fresh one is an HTTP round trip to GoTrue rather
 * than a local decode. A page whose layout, its own body and a lib helper each
 * called `createClient()` was paying three of those, plus three identical
 * `user_preferences` reads, because the memo inside
 * `lib/sleeper-handle/resolve.ts` is keyed on the client instance and a new
 * instance defeats it every time.
 *
 * Sharing is safe here because the client is already request-scoped: it reads
 * `cookies()`, which Next scopes to the request.
 */
export const createClient = cache(async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll called from a Server Component, ignore. Middleware refreshes the session.
          }
        },
      },
    },
  );
});

/**
 * A cookie-less anon client for use inside unstable_cache (#1 performance).
 * unstable_cache forbids cookies()/headers() access, so the request-scoped
 * createClient() cannot be used there. This client carries the publishable
 * (anon) key, so RLS still applies and only public-read data is reachable, which
 * is exactly what the cached player-scoped loaders read. Not for user-scoped or
 * write paths.
 */
export function createCachedReadClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export function createAdminClient() {
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {},
      },
    },
  );
}
