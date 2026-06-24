"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { approveDeletion, rejectDeletion } from "@/lib/beacon-brief/deletion";
import {
  dismissReferenceMatch,
  resolveReferenceMatch,
} from "@/lib/beacon-brief/match-resolution";

export type ActionResult = { ok: true } | { ok: false; error: string };
const fail = (error: string): ActionResult => ({ ok: false, error });

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "category"
  );
}

const BB = "/admin/beacon-brief";

// -------- Sources --------

export async function createSource(
  adminLabel: string,
  sourceType: string,
  handle: string,
): Promise<ActionResult> {
  await requireAdmin(`${BB}/sources`);
  const admin = createAdminClient();
  const label = adminLabel.trim();
  const h = handle.replace(/^@/, "").trim();
  if (!label || !h) return fail("Label and handle are required.");
  if (sourceType !== "x") return fail("Unsupported source type.");
  const { error } = await admin
    .from("news_sources")
    .insert({ admin_label: label, source_type: sourceType, handle: h });
  if (error) return fail(error.message);
  revalidatePath(`${BB}/sources`);
  return { ok: true };
}

export async function updateSource(
  id: string,
  adminLabel: string,
  handle: string,
): Promise<ActionResult> {
  await requireAdmin(`${BB}/sources`);
  const admin = createAdminClient();
  const label = adminLabel.trim();
  const h = handle.replace(/^@/, "").trim();
  if (!label || !h) return fail("Label and handle are required.");
  // Changing the handle invalidates the resolved account id + cursor.
  const { error } = await admin
    .from("news_sources")
    .update({
      admin_label: label,
      handle: h,
      external_account_id: null,
      last_cursor: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return fail(error.message);
  revalidatePath(`${BB}/sources`);
  return { ok: true };
}

export async function toggleSource(
  id: string,
  isActive: boolean,
): Promise<ActionResult> {
  await requireAdmin(`${BB}/sources`);
  const admin = createAdminClient();
  const { error } = await admin
    .from("news_sources")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return fail(error.message);
  revalidatePath(`${BB}/sources`);
  return { ok: true };
}

export async function deleteSource(id: string): Promise<ActionResult> {
  await requireAdmin(`${BB}/sources`);
  const admin = createAdminClient();
  const { error } = await admin.from("news_sources").delete().eq("id", id);
  if (error) return fail(error.message);
  revalidatePath(`${BB}/sources`);
  return { ok: true };
}

// -------- Categories --------

export async function createCategory(
  name: string,
  description: string,
  discordRoleIds: string[],
  displayOrder: number,
): Promise<ActionResult> {
  await requireAdmin(`${BB}/categories`);
  const admin = createAdminClient();
  const n = name.trim();
  if (!n) return fail("Name is required.");
  const { error } = await admin.from("news_categories").insert({
    name: n,
    slug: slugify(n),
    description: description.trim() || null,
    discord_role_ids: discordRoleIds.map((r) => r.trim()).filter(Boolean),
    display_order: Number.isFinite(displayOrder) ? displayOrder : 0,
  });
  if (error) return fail(error.message);
  revalidatePath(`${BB}/categories`);
  return { ok: true };
}

export async function updateCategory(
  id: string,
  name: string,
  description: string,
  discordRoleIds: string[],
  displayOrder: number,
): Promise<ActionResult> {
  await requireAdmin(`${BB}/categories`);
  const admin = createAdminClient();
  const n = name.trim();
  if (!n) return fail("Name is required.");
  const { error } = await admin
    .from("news_categories")
    .update({
      name: n,
      description: description.trim() || null,
      discord_role_ids: discordRoleIds.map((r) => r.trim()).filter(Boolean),
      display_order: Number.isFinite(displayOrder) ? displayOrder : 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return fail(error.message);
  revalidatePath(`${BB}/categories`);
  return { ok: true };
}

export async function toggleCategory(
  id: string,
  isActive: boolean,
): Promise<ActionResult> {
  await requireAdmin(`${BB}/categories`);
  const admin = createAdminClient();
  const { error } = await admin
    .from("news_categories")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return fail(error.message);
  revalidatePath(`${BB}/categories`);
  return { ok: true };
}

export async function deleteCategory(id: string): Promise<ActionResult> {
  await requireAdmin(`${BB}/categories`);
  const admin = createAdminClient();
  const { error } = await admin.from("news_categories").delete().eq("id", id);
  if (error) return fail(error.message);
  revalidatePath(`${BB}/categories`);
  return { ok: true };
}

// -------- Articles --------

export async function updateArticleContent(
  id: string,
  fields: {
    title: string;
    meta_description: string;
    tl_dr: string;
    content_md: string;
    status: string;
  },
): Promise<ActionResult> {
  await requireAdmin(`${BB}/articles`);
  const admin = createAdminClient();
  if (!fields.title.trim()) return fail("Title is required.");
  if (!["draft", "published", "archived"].includes(fields.status))
    return fail("Invalid status.");
  const { error } = await admin
    .from("articles")
    .update({
      title: fields.title.trim(),
      meta_description: fields.meta_description.trim() || null,
      tl_dr: fields.tl_dr.trim() || null,
      content_md: fields.content_md,
      status: fields.status,
      published_at:
        fields.status === "published" ? new Date().toISOString() : null,
      last_updated: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return fail(error.message);
  revalidatePath(`${BB}/articles`);
  return { ok: true };
}

export async function updateArticleAssignments(
  id: string,
  categoryId: string | null,
  tags: string[],
  playerIds: string[],
  teamIds: string[],
): Promise<ActionResult> {
  await requireAdmin(`${BB}/articles`);
  const admin = createAdminClient();

  const { error: aErr } = await admin
    .from("articles")
    .update({
      category_id: categoryId,
      tags: tags.map((t) => t.trim()).filter(Boolean),
      last_updated: new Date().toISOString(),
    })
    .eq("id", id);
  if (aErr) return fail(aErr.message);

  // Replace the player/team join sets.
  await admin.from("article_players").delete().eq("article_id", id);
  if (playerIds.length > 0) {
    const { error } = await admin
      .from("article_players")
      .insert(playerIds.map((pid) => ({ article_id: id, player_id: pid })));
    if (error) return fail(error.message);
  }
  await admin.from("article_teams").delete().eq("article_id", id);
  if (teamIds.length > 0) {
    const { error } = await admin
      .from("article_teams")
      .insert(teamIds.map((tid) => ({ article_id: id, team_id: tid })));
    if (error) return fail(error.message);
  }
  revalidatePath(`${BB}/articles`);
  return { ok: true };
}

export interface PlayerOption {
  id: string;
  full_name: string;
  position: string | null;
  team: string | null;
}

/** Search players by name for the article player picker (admin only). */
export async function searchPlayers(query: string): Promise<PlayerOption[]> {
  await requireAdmin(`${BB}/articles`);
  const admin = createAdminClient();
  const q = query.replace(/[(),*%]/g, " ").trim();
  if (q.length < 2) return [];
  const { data } = await admin
    .from("players")
    .select("id, full_name, position, team")
    .ilike("full_name", `%${q}%`)
    .limit(15);
  return (data ?? []) as PlayerOption[];
}

export interface ArticleDetail {
  players: { id: string; full_name: string }[];
  teams: { id: string; abbreviation: string }[];
  revisions: {
    revision_number: number;
    title: string | null;
    change_summary: string | null;
    created_at: string;
  }[];
}

/** Lazy-load an article's linked players/teams + revision history for the editor. */
export async function getArticleDetail(
  articleId: string,
): Promise<ArticleDetail> {
  await requireAdmin(`${BB}/articles`);
  const admin = createAdminClient();
  const [players, teams, revisions] = await Promise.all([
    admin
      .from("article_players")
      .select("players(id, full_name)")
      .eq("article_id", articleId),
    admin
      .from("article_teams")
      .select("teams(id, abbreviation)")
      .eq("article_id", articleId),
    admin
      .from("article_revisions")
      .select("revision_number, title, change_summary, created_at")
      .eq("article_id", articleId)
      .order("revision_number", { ascending: false }),
  ]);
  return {
    players: (players.data ?? [])
      .map(
        (r) =>
          (r as { players?: { id: string; full_name: string } | null }).players,
      )
      .filter((p): p is { id: string; full_name: string } => Boolean(p)),
    teams: (teams.data ?? [])
      .map(
        (r) =>
          (r as { teams?: { id: string; abbreviation: string } | null }).teams,
      )
      .filter((t): t is { id: string; abbreviation: string } => Boolean(t)),
    revisions: (revisions.data ?? []) as ArticleDetail["revisions"],
  };
}

// -------- Logs --------

function jsonText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Lazy-load one log row's request/response jsonb on demand (when the admin
 * expands the disclosure). The logs list query never selects these payloads, so
 * a page of 100 rows never ships up to 200 large blobs the admin may not open.
 */
export async function getBeaconBriefLogPayload(
  id: string,
): Promise<{ request: string | null; response: string | null }> {
  await requireAdmin(`${BB}/logs`);
  const admin = createAdminClient();
  const { data } = await admin
    .from("beacon_brief_logs")
    .select("request_payload, response_payload")
    .eq("id", id)
    .maybeSingle();
  return {
    request: jsonText(data?.request_payload),
    response: jsonText(data?.response_payload),
  };
}

// -------- Moderation --------

export async function approveModeration(id: string): Promise<ActionResult> {
  const { userId } = await requireAdmin(`${BB}/moderation`);
  const admin = createAdminClient();
  try {
    await approveDeletion(admin, id, userId);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "approve failed");
  }
  revalidatePath(`${BB}/moderation`);
  return { ok: true };
}

export async function rejectModeration(id: string): Promise<ActionResult> {
  const { userId } = await requireAdmin(`${BB}/moderation`);
  const admin = createAdminClient();
  try {
    await rejectDeletion(admin, id, userId);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "reject failed");
  }
  revalidatePath(`${BB}/moderation`);
  return { ok: true };
}

/** Resolve a player_match/team_match: link the chosen player/team to the article. */
export async function resolveMatch(
  moderationId: string,
  chosenId: string,
): Promise<ActionResult> {
  const { userId } = await requireAdmin(`${BB}/moderation`);
  const admin = createAdminClient();
  try {
    await resolveReferenceMatch(admin, moderationId, chosenId, userId);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "resolve failed");
  }
  revalidatePath(`${BB}/moderation`);
  return { ok: true };
}

/** Dismiss a player_match/team_match without linking anything. */
export async function dismissMatch(
  moderationId: string,
): Promise<ActionResult> {
  const { userId } = await requireAdmin(`${BB}/moderation`);
  const admin = createAdminClient();
  try {
    await dismissReferenceMatch(admin, moderationId, userId);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "dismiss failed");
  }
  revalidatePath(`${BB}/moderation`);
  return { ok: true };
}
