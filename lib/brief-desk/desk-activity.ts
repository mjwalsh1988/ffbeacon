/**
 * The last time the desk asked for a bundle and the last time it sent a draft,
 * read from beacon_brief_logs rows the two desk routes write with stage
 * 'brief_desk' (plan section 10.3). Shared by the overview and the settings
 * page so both say the same thing.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export interface DeskLogEntry {
  at: string;
  message: string;
}

export interface DeskActivity {
  lastBundle: DeskLogEntry | null;
  lastDraft: DeskLogEntry | null;
}

async function lastEntry(
  admin: SupabaseClient<Database>,
  prefix: string,
): Promise<DeskLogEntry | null> {
  const { data } = await admin
    .from("beacon_brief_logs")
    .select("created_at, message")
    .eq("stage", "brief_desk")
    .ilike("message", `${prefix}%`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { at: data.created_at, message: data.message ?? prefix };
}

export async function loadDeskActivity(admin: SupabaseClient<Database>): Promise<DeskActivity> {
  const [lastBundle, lastDraft] = await Promise.all([lastEntry(admin, "bundle"), lastEntry(admin, "draft")]);
  return { lastBundle, lastDraft };
}
