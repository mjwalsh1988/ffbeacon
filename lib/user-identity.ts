/**
 * Shared public identity resolver for leaderboard display names and avatars
 * (plan: signal-scout-plan.md section 8, decision 7).
 *
 * This is the ONE resolver for the My Beacon display-name/avatar hierarchy so
 * leaderboards do not become a fifth inline copy of the hierarchy. The four
 * existing inline copies (app/admin/page.tsx, app/my-beacon/layout.tsx, and
 * others) can migrate to this module later.
 *
 * PRIVACY RULES: callers must key responses by rank or position, never
 * serialize the raw auth user id to a client. This module returns display
 * data only (a name and, at most, a short-lived signed avatar URL).
 */

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Client = SupabaseClient<Database>;

/**
 * Signed avatar URL lifetime in seconds. Mirrors the TTL used by
 * app/admin/page.tsx and the edit-profile page (1 hour); display-only, not a
 * security boundary.
 */
const AVATAR_SIGNED_URL_TTL = 60 * 60;

/**
 * "public" is for surfaces visible to other users (leaderboards); the email
 * local-part step is masked there. "private" is for surfaces shown only to
 * the user themself (dashboard greeting); the email local-part renders
 * verbatim.
 */
export type IdentitySurface = "public" | "private";

/**
 * Masks an email local part to its first two characters plus a fixed
 * three-asterisk suffix ("mi***"). Fewer than two characters uses what
 * exists plus the three asterisks ("a***"). The asterisk count is fixed
 * (never scales with input length) so the mask does not leak the local
 * part's length. Input is trimmed first; empty input returns an empty
 * string so the caller falls through the rest of the hierarchy.
 */
export function maskEmailLocalPart(localPart: string): string {
  const trimmed = localPart.trim();
  if (!trimmed) return "";
  return `${trimmed.slice(0, 2)}***`;
}

/**
 * Deterministic display placeholder: "Scout-" + first 4 hex chars of
 * sha256(user id). No salt is needed because this is a display label, not a
 * security boundary. Moved here from lib/signal-scout/route-helpers.ts as
 * part of SS-T032; this is now the canonical home for every identity helper
 * shared across Signal Scout and (eventually) the rest of the site.
 */
export function scoutFallbackLabel(userId: string): string {
  return `Scout-${createHash("sha256").update(userId).digest("hex").slice(0, 4)}`;
}

interface DisplayNameInput {
  userId: string;
  metaDisplayName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}

/**
 * Pure, unit-testable display-name hierarchy. Matches the My Beacon greeting
 * logic (app/my-beacon/layout.tsx) with the leaderboard's masked-email
 * public variant added:
 *   1. metaDisplayName, trimmed, when non-empty.
 *   2. firstName, trimmed, when non-empty; if lastName is also present,
 *      "First L." (a space, the first character of the trimmed last name,
 *      and a period); first name alone otherwise.
 *   3. email local part (text before the first "@"): verbatim on "private",
 *      masked via maskEmailLocalPart on "public". Skipped when empty.
 *   4. scoutFallbackLabel(userId).
 * Whitespace-only values at any step are treated as missing.
 */
export function deriveDisplayName(input: DisplayNameInput, surface: IdentitySurface): string {
  const metaDisplayName = input.metaDisplayName?.trim() ?? "";
  if (metaDisplayName) return metaDisplayName;

  const firstName = input.firstName?.trim() ?? "";
  if (firstName) {
    const lastName = input.lastName?.trim() ?? "";
    return lastName ? `${firstName} ${lastName.charAt(0)}.` : firstName;
  }

  const localPart = input.email?.split("@")[0]?.trim() ?? "";
  if (localPart) {
    return surface === "private" ? localPart : maskEmailLocalPart(localPart);
  }

  return scoutFallbackLabel(input.userId);
}

export interface ResolvedUserIdentity {
  displayName: string;
  avatarUrl: string | null;
}

/**
 * Resolves display identities for a batch of user ids: one user_preferences
 * query, parallel auth lookups (admin.auth.admin.getUserById), and one
 * batched avatar-signing call. Never throws; every requested id gets a Map
 * entry, degrading through the hierarchy on any partial failure.
 */
export async function resolveUserIdentities(
  admin: Client,
  userIds: string[],
  surface: IdentitySurface,
): Promise<Map<string, ResolvedUserIdentity>> {
  const ids = [...new Set(userIds)];
  const result = new Map<string, ResolvedUserIdentity>();
  if (ids.length === 0) return result;

  const prefsByUser = new Map<
    string,
    { first_name: string | null; last_name: string | null; avatar_path: string | null }
  >();
  try {
    const { data, error } = await admin
      .from("user_preferences")
      .select("user_id, first_name, last_name, avatar_path")
      .in("user_id", ids);
    if (error) throw error;
    for (const row of data ?? []) {
      prefsByUser.set(row.user_id, {
        first_name: row.first_name,
        last_name: row.last_name,
        avatar_path: row.avatar_path,
      });
    }
  } catch (err) {
    console.error("[user-identity] user_preferences lookup failed", err);
  }

  const authByUser = new Map<string, { email: string | null; metaDisplayName: string | null }>();
  await Promise.all(
    ids.map(async (id) => {
      try {
        const { data, error } = await admin.auth.admin.getUserById(id);
        if (error || !data?.user) return;
        const metaDisplayName =
          typeof data.user.user_metadata?.display_name === "string"
            ? (data.user.user_metadata.display_name as string)
            : null;
        authByUser.set(id, { email: data.user.email ?? null, metaDisplayName });
      } catch (err) {
        console.error("[user-identity] auth lookup failed", err);
      }
    }),
  );

  const avatarPaths = [
    ...new Set(
      ids
        .map((id) => prefsByUser.get(id)?.avatar_path)
        .filter((path): path is string => Boolean(path)),
    ),
  ];
  const signedUrlByPath = new Map<string, string>();
  if (avatarPaths.length > 0) {
    try {
      const { data, error } = await admin.storage
        .from("user-avatars")
        .createSignedUrls(avatarPaths, AVATAR_SIGNED_URL_TTL);
      if (error) {
        console.error("[user-identity] avatar signing failed", error);
      } else {
        for (const entry of data ?? []) {
          if (entry.path && entry.signedUrl && !entry.error) {
            signedUrlByPath.set(entry.path, entry.signedUrl);
          }
        }
      }
    } catch (err) {
      console.error("[user-identity] avatar signing failed", err);
    }
  }

  for (const id of ids) {
    const prefs = prefsByUser.get(id) ?? null;
    const auth = authByUser.get(id) ?? null;
    const displayName = deriveDisplayName(
      {
        userId: id,
        metaDisplayName: auth?.metaDisplayName ?? null,
        firstName: prefs?.first_name ?? null,
        lastName: prefs?.last_name ?? null,
        email: auth?.email ?? null,
      },
      surface,
    );
    const avatarPath = prefs?.avatar_path ?? null;
    const avatarUrl = avatarPath ? (signedUrlByPath.get(avatarPath) ?? null) : null;
    result.set(id, { displayName, avatarUrl });
  }

  return result;
}
