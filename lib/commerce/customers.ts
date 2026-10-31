/**
 * Who bought it, without ever paging the Auth user list.
 *
 * Two service-role RPCs (migration 0352) do what `auth.admin.listUsers` would do
 * for one page of orders. One RPC call and one user_preferences read answer any
 * number of ids, and the display name goes through the same `deriveDisplayName`
 * hierarchy My Beacon uses, so a name on an order matches the name everywhere else.
 *
 * NEVER `listUsers`, and never `getUserById` in a loop over a page.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { deriveDisplayName } from "@/lib/user-identity";

type Client = SupabaseClient<Database>;

export type Customer = {
  userId: string;
  email: string | null;
  displayName: string;
  memberSince: string | null;
};

export async function lookupCustomers(
  admin: Client,
  userIds: Array<string | null | undefined>,
): Promise<Map<string, Customer>> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  const result = new Map<string, Customer>();
  if (ids.length === 0) return result;

  const [identities, prefs] = await Promise.all([
    admin.rpc("order_customer_identities", { p_user_ids: ids }),
    admin.from("user_preferences").select("user_id, first_name, last_name").in("user_id", ids),
  ]);
  if (identities.error) console.error("[orders] identity lookup failed", identities.error.message);
  if (prefs.error) console.error("[orders] preferences lookup failed", prefs.error.message);

  const auth = new Map((identities.data ?? []).map((row) => [row.user_id, row]));
  const names = new Map((prefs.data ?? []).map((row) => [row.user_id, row]));

  for (const id of ids) {
    const identity = auth.get(id);
    const pref = names.get(id);
    result.set(id, {
      userId: id,
      email: identity?.email ?? null,
      memberSince: identity?.created_at ?? null,
      displayName: deriveDisplayName(
        {
          userId: id,
          metaDisplayName: identity?.meta_display_name ?? null,
          firstName: pref?.first_name ?? null,
          lastName: pref?.last_name ?? null,
          email: identity?.email ?? null,
        },
        "private",
      ),
    });
  }
  return result;
}

/** Accounts whose email contains `q`, newest first. */
export async function searchCustomers(
  admin: Client,
  q: string,
  limit = 20,
): Promise<Array<{ userId: string; email: string }>> {
  const trimmed = q.trim();
  if (trimmed.length < 2) return [];
  const { data, error } = await admin.rpc("search_order_customers", {
    p_query: trimmed,
    p_limit: limit,
  });
  if (error) {
    console.error("[orders] customer search failed", error.message);
    return [];
  }
  return (data ?? []).map((row) => ({ userId: row.user_id, email: row.email }));
}
