"use server";

/**
 * Server actions for the Brief desk admin pages. Every action re-checks admin
 * through requireAdmin (never trusts the client), writes through the
 * service-role client, and revalidates the page it changed. The edition
 * actions call lib/brief-desk/publish.ts; the Relay actions call
 * lib/relays/write.ts. Approval is the only path to status = 'published' for
 * a Brief, and it lives here behind requireAdmin (plan section 15).
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import { bustMemo } from "@/lib/memo-ttl";
import {
  approveEdition,
  archiveEdition,
  rejectEdition,
  updateEditionText,
  type EditionTextEdit,
} from "@/lib/brief-desk/publish";
import { BRIEF_DESK_MEMO_KEY } from "@/lib/brief-desk/settings";
import { mergeReviewTicks } from "@/lib/brief-desk/review-ticks";
import {
  setRelayStatus,
  updateRelayText,
  type RelayTextEdit,
} from "@/lib/relays/write";
import type { GroundingFailure } from "@/lib/relays/grounding";
import type { RelayStatus } from "@/lib/relays/types";

export type ActionResult = { ok: true } | { ok: false; error: string };
const fail = (error: string): ActionResult => ({ ok: false, error });

const BD = "/admin/brief-desk";

/**
 * Every argument is checked at runtime, after requireAdmin. A server action
 * is an HTTP endpoint whatever the TypeScript signature says, and an
 * argument of the wrong shape used to reach the libraries as-is: a title
 * choice of "constructor" indexed Array.prototype, and a non-string reason
 * threw a TypeError instead of returning { ok: false }.
 */
const ID = z.string().uuid();
const REASON = z.string().max(2000);
const APPROVE_INPUT = z
  .object({ postToDiscord: z.boolean(), titleChoice: z.number().int().min(0).max(2).nullable() })
  .strict();
const TICKS = z.array(z.string().max(1000)).max(1000);
const EDITION_TEXT_EDIT = z
  .object({
    title: z.string().max(200).optional(),
    meta_description: z.string().max(400).optional(),
    tl_dr: z.string().max(4000).optional(),
    sections: z.record(z.string().max(80), z.string().max(60_000)).optional(),
    blocks: z.record(z.string().max(80), z.object({ caption: z.string().max(400), conclusion: z.string().max(1000) }).strict()).optional(),
  })
  .strict();
const RELAY_TEXT_EDIT = z
  .object({
    headline: z.string().max(400),
    facts: z.array(z.object({ label: z.string().max(80), value: z.string().max(240) }).strict()).max(12),
    timeline: z.string().max(400).nullable(),
  })
  .strict();
const SETTING_KEY = z.string().regex(/^[a-z0-9_]{1,80}$/);
const SETTING_RAW = z.string().max(40_000);

type Parsed<T> = { ok: true; data: T } | { ok: false; error: string };
function parse<T>(schema: z.ZodType<T>, value: unknown): Parsed<T> {
  const res = schema.safeParse(value);
  return res.success ? { ok: true, data: res.data } : { ok: false, error: `Invalid input: ${res.error.issues[0]?.message ?? "shape"}` };
}

function revalidateEdition(editionId: string) {
  revalidatePath(`${BD}`);
  revalidatePath(`${BD}/editions`);
  revalidatePath(`${BD}/editions/${editionId}`);
}

// -------- Editions --------

export async function approveBriefEdition(
  editionId: string,
  input: { postToDiscord: boolean; titleChoice: number | null },
): Promise<ActionResult> {
  const { userId } = await requireAdmin(`${BD}/editions/${editionId}`);
  const id = parse(ID, editionId);
  if (!id.ok) return fail(id.error);
  const args = parse(APPROVE_INPUT, input);
  if (!args.ok) return fail(args.error);
  const admin = createAdminClient();
  // The ticks recorded during review are the owner's record; carry them onto
  // the approved row rather than letting the approve overwrite them with null.
  const { data: current } = await admin
    .from("brief_editions")
    .select("review_notes")
    .eq("id", id.data)
    .maybeSingle();
  const res = await approveEdition(admin, {
    editionId: id.data,
    reviewedBy: userId,
    postToDiscord: args.data.postToDiscord,
    titleChoice: args.data.titleChoice,
    notes: current?.review_notes ?? null,
  });
  if (!res.ok) return fail(res.error);
  revalidateEdition(editionId);
  revalidatePath("/brief");
  revalidatePath("/brief/editions");
  revalidatePath(`/brief/${res.slug}`);
  return { ok: true };
}

export async function rejectBriefEdition(
  editionId: string,
  notes: string,
): Promise<ActionResult> {
  const { userId } = await requireAdmin(`${BD}/editions/${editionId}`);
  const id = parse(ID, editionId);
  if (!id.ok) return fail(id.error);
  const text = parse(REASON, notes);
  if (!text.ok) return fail(text.error);
  const admin = createAdminClient();
  const res = await rejectEdition(admin, { editionId: id.data, reviewedBy: userId, notes: text.data });
  if (!res.ok) return fail(res.error);
  revalidateEdition(editionId);
  return { ok: true };
}

export async function archiveBriefEdition(editionId: string): Promise<ActionResult> {
  const { userId } = await requireAdmin(`${BD}/editions/${editionId}`);
  const id = parse(ID, editionId);
  if (!id.ok) return fail(id.error);
  const admin = createAdminClient();
  const res = await archiveEdition(admin, { editionId: id.data, reviewedBy: userId });
  if (!res.ok) return fail(res.error);
  revalidateEdition(editionId);
  return { ok: true };
}

export async function saveEditionText(
  editionId: string,
  edit: EditionTextEdit,
): Promise<ActionResult> {
  const { userId } = await requireAdmin(`${BD}/editions/${editionId}`);
  const id = parse(ID, editionId);
  if (!id.ok) return fail(id.error);
  const body = parse(EDITION_TEXT_EDIT, edit);
  if (!body.ok) return fail(body.error);
  const admin = createAdminClient();
  const res = await updateEditionText(admin, { editionId: id.data, reviewedBy: userId, edit: body.data });
  if (!res.ok) return fail(res.error);
  revalidateEdition(editionId);
  revalidatePath(`/brief/${res.slug}`);
  return { ok: true };
}

/**
 * Store the owner's ticks (cleared warnings, read research rows) as text lines
 * in brief_editions.review_notes. Tick lines carry the "[x] " prefix; any other
 * line already in the column (rejection notes) is kept as it was.
 */
export async function saveEditionReviewTicks(
  editionId: string,
  ticks: string[],
): Promise<ActionResult> {
  await requireAdmin(`${BD}/editions/${editionId}`);
  const id = parse(ID, editionId);
  if (!id.ok) return fail(id.error);
  const list = parse(TICKS, ticks);
  if (!list.ok) return fail(list.error);
  const admin = createAdminClient();
  const { data: current } = await admin
    .from("brief_editions")
    .select("id, review_notes")
    .eq("id", id.data)
    .maybeSingle();
  if (!current) return fail("Edition not found.");
  const { error } = await admin
    .from("brief_editions")
    .update({ review_notes: mergeReviewTicks(current.review_notes, list.data) })
    .eq("id", id.data);
  if (error) return fail(error.message);
  revalidatePath(`${BD}/editions/${editionId}`);
  return { ok: true };
}

// -------- Relays --------

const RELAYS = `${BD}/relays`;

export async function hideRelay(relayId: string, reason: string): Promise<ActionResult> {
  await requireAdmin(RELAYS);
  const id = parse(ID, relayId);
  if (!id.ok) return fail(id.error);
  const text = parse(REASON, reason);
  if (!text.ok) return fail(text.error);
  const admin = createAdminClient();
  if (!text.data.trim()) return fail("A reason is required to hide a Relay.");
  const res = await setRelayStatus(admin, id.data, "hidden", text.data);
  if (!res.ok) return fail(res.error ?? "hide failed");
  revalidatePath(RELAYS);
  revalidatePath("/brief");
  return { ok: true };
}

export async function unhideRelay(relayId: string): Promise<ActionResult> {
  await requireAdmin(RELAYS);
  const id = parse(ID, relayId);
  if (!id.ok) return fail(id.error);
  const admin = createAdminClient();
  const res = await setRelayStatus(admin, id.data, "published", null);
  if (!res.ok) return fail(res.error ?? "unhide failed");
  revalidatePath(RELAYS);
  revalidatePath("/brief");
  return { ok: true };
}

/**
 * Publish a hidden Relay WITHOUT the grounding re-check: the owner has read
 * it against the source post and is overruling the check. The reason recorded
 * says so, so the override is visible in the manager afterwards.
 */
export async function publishRelayAnyway(relayId: string): Promise<ActionResult> {
  await requireAdmin(RELAYS);
  const id = parse(ID, relayId);
  if (!id.ok) return fail(id.error);
  const admin = createAdminClient();
  const res = await setRelayStatus(admin, id.data, "published", "Published by the owner over a grounding failure", { force: true });
  if (!res.ok) return fail(res.error ?? "publish failed");
  revalidatePath(RELAYS);
  revalidatePath("/brief");
  return { ok: true };
}

export async function retractRelay(relayId: string, reason: string): Promise<ActionResult> {
  await requireAdmin(RELAYS);
  const id = parse(ID, relayId);
  if (!id.ok) return fail(id.error);
  const text = parse(REASON, reason);
  if (!text.ok) return fail(text.error);
  const admin = createAdminClient();
  if (!text.data.trim()) return fail("A reason is required to retract a Relay.");
  const res = await setRelayStatus(admin, id.data, "retracted", text.data);
  if (!res.ok) return fail(res.error ?? "retract failed");
  revalidatePath(RELAYS);
  revalidatePath("/brief");
  return { ok: true };
}

export type EditRelayResult =
  | { ok: true; status: RelayStatus; failures: GroundingFailure[] }
  | { ok: false; error: string; failures: GroundingFailure[] };

/**
 * Edit a Relay's headline, facts and timeline. The grounding check re-runs
 * against the stored post; a pass publishes it, a miss keeps it hidden and
 * returns the failing tokens so the page can show them.
 */
export async function editRelay(relayId: string, edit: RelayTextEdit): Promise<EditRelayResult> {
  await requireAdmin(RELAYS);
  const id = parse(ID, relayId);
  if (!id.ok) return { ok: false, error: id.error, failures: [] };
  const body = parse(RELAY_TEXT_EDIT, edit);
  if (!body.ok) return { ok: false, error: body.error, failures: [] };
  const admin = createAdminClient();
  const res = await updateRelayText(admin, id.data, body.data, { publishIfGrounded: true });
  if (!res.ok) return { ok: false, error: res.error ?? "edit failed", failures: res.failures };
  revalidatePath(RELAYS);
  revalidatePath("/brief");
  return { ok: true, status: res.status, failures: res.failures };
}

// -------- Settings --------

/**
 * Update one beacon_settings row in the brief_desk category (or the legacy
 * bb_article_write_enabled row), coercing the input to its declared type.
 * Mirrors updateBeaconSetting and busts the matching memo so the next read
 * on this process goes back to the database.
 */
export async function updateBriefDeskSetting(key: string, raw: string): Promise<ActionResult> {
  const { userId } = await requireAdmin(`${BD}/settings`);
  const name = parse(SETTING_KEY, key);
  if (!name.ok) return fail(name.error);
  const rawText = parse(SETTING_RAW, raw);
  if (!rawText.ok) return fail(rawText.error);
  key = name.data;
  raw = rawText.data;
  const admin = createAdminClient();
  const { data: row, error: readErr } = await admin
    .from("beacon_settings")
    .select("value_type, category")
    .eq("key", key)
    .maybeSingle();
  if (readErr || !row) return fail(readErr?.message ?? `Unknown setting: ${key}`);
  if (row.category !== "brief_desk" && key !== "bb_article_write_enabled") {
    return fail("That setting is not managed from this page.");
  }

  let value: unknown;
  if (row.value_type === "number") {
    const n = Number(raw);
    if (!Number.isFinite(n)) return fail("Value must be a number.");
    value = n;
  } else if (row.value_type === "boolean") {
    value = raw === "true";
  } else {
    value = raw;
  }

  const { error } = await admin
    .from("beacon_settings")
    .update({ value: value as never, updated_by: userId, updated_at: new Date().toISOString() })
    .eq("key", key);
  if (error) return fail(error.message);
  if (row.category === "brief_desk") bustMemo(BRIEF_DESK_MEMO_KEY);
  else bustMemo("settings:beacon");
  revalidatePath(`${BD}/settings`);
  return { ok: true };
}
