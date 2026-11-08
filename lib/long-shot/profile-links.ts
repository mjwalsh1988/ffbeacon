/**
 * Signal profile links for usernames shown in a game (owner decision 5).
 *
 * A user's name links to /u/[handle] only when that profile is LIVE:
 * status = 'published', visibility = 'public' and hidden = false on the
 * signals table. Anyone else renders as plain text.
 *
 * This is the shared implementation for any other game that wants the same
 * link; Signal Scout does not use it yet.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Client = SupabaseClient<Database>;

export const PROFILE_CHUNK = 200;

export async function resolveLiveProfileHandles(admin: Client, userIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(new Set(userIds));
  for (let i = 0; i < unique.length; i += PROFILE_CHUNK) {
    const { data, error } = await admin
      .from("signals")
      .select("user_id, handle")
      .in("user_id", unique.slice(i, i + PROFILE_CHUNK))
      .eq("status", "published")
      .eq("visibility", "public")
      .eq("hidden", false);
    if (error) throw new Error(`profile handle read failed: ${error.message}`);
    for (const row of data ?? []) {
      if (row.user_id && row.handle) out.set(row.user_id, String(row.handle));
    }
  }
  return out;
}

export function profileHrefFor(handles: ReadonlyMap<string, string>, userId: string): string | null {
  const handle = handles.get(userId);
  return handle ? `/u/${encodeURIComponent(handle)}` : null;
}
