import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getClaims, NOT getUser.
  //
  // A session token is a signed note. Under the older Supabase setup it is
  // signed with a shared secret only the auth server holds, so the only way to
  // check the signature is to send the note back: a network round trip, 70 ms
  // measured, on every matched request for every signed-in reader, in front of
  // routing. This project publishes an ES256 PUBLIC key at
  // /auth/v1/.well-known/jwks.json, so the signature can be checked here in
  // well under a millisecond instead.
  //
  // The session refresh this function exists for is unaffected: getClaims with
  // no argument calls getSession() first, which is what refreshes an expiring
  // token and writes the rotated cookies through the setAll handler above.
  //
  // It also degrades safely. If a token turns out to be HS256-signed, or
  // carries no key id, or WebCrypto is unavailable, auth-js falls back to
  // getUser() internally, which is exactly the behaviour this line replaced.
  // So this is never less correct than what it replaces, only sometimes
  // faster.
  //
  // The server-verified identity is still the one that gates admin. That read
  // stays in `lib/nav-viewer.ts`, on getUser, in the render.
  await supabase.auth.getClaims();

  return supabaseResponse;
}
