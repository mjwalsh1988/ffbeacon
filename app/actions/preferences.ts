"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  SOURCE_COOKIE,
  FORMAT_COOKIE,
  PREFERENCE_COOKIE_OPTIONS,
  VALID_PREFERENCE_SLUG as VALID_SLUG,
} from "@/lib/preferences";

export async function saveSourcePreference(slug: string | null): Promise<void> {
  if (slug !== null && !VALID_SLUG.test(slug)) return;

  const supabase = await createClient();

  if (slug !== null) {
    const { data: row } = await supabase
      .from("source_registry")
      .select("slug")
      .eq("slug", slug)
      .eq("is_active", true)
      .maybeSingle();
    if (!row) return;
  }

  const store = await cookies();
  if (slug === null) {
    store.delete(SOURCE_COOKIE);
  } else {
    store.set(SOURCE_COOKIE, slug, PREFERENCE_COOKIE_OPTIONS);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("user_preferences")
    .upsert(
      {
        user_id: user.id,
        default_source_slug: slug,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
}

export async function saveFormatPreference(slug: string | null): Promise<void> {
  if (slug !== null && !VALID_SLUG.test(slug)) return;

  const supabase = await createClient();

  let formatId: string | null = null;
  if (slug !== null) {
    const { data: row } = await supabase
      .from("format_configs")
      .select("id")
      .eq("slug", slug)
      .eq("is_active", true)
      .maybeSingle();
    if (!row) return;
    formatId = row.id;
  }

  const store = await cookies();
  if (slug === null) {
    store.delete(FORMAT_COOKIE);
  } else {
    store.set(FORMAT_COOKIE, slug, PREFERENCE_COOKIE_OPTIONS);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("user_preferences")
    .upsert(
      {
        user_id: user.id,
        default_format_config_id: formatId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
}
