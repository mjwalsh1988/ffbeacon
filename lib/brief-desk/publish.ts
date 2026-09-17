/**
 * Approve, reject, archive and edit an edition (plan section 10.1).
 *
 * Approval is the ONLY path to status = 'published' for a Brief, and it is
 * what earns the byline: the owner has read the draft and stands behind it.
 * It sets the article live, stamps relays.brief_id on every cited Relay,
 * resolves the review row, busts the homepage cache, submits the URL to
 * IndexNow and, when asked, enqueues the Discord post (the one place in this
 * feature that mentions anyone and carries a link).
 *
 * Rejecting keeps the edition row with status 'rejected' for the record; the
 * period reopens by itself because a period is due whenever it has no edition
 * in review or published. The next bundle carries the notes.
 *
 * Every write here is service-role and every caller sits behind requireAdmin
 * (app/admin/brief-desk/actions.ts).
 */

import { revalidateTag } from "next/cache";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { submitIndexNow } from "@/lib/indexnow";
import { bustMemo } from "@/lib/memo-ttl";
import { HAS_EDITIONS_MEMO_KEY } from "@/lib/sitemap/sections";
import { logBeaconBrief } from "@/lib/beacon-brief/ai";
import { draftSchema } from "./draft-schema";
import { loadBriefDeskSettings } from "./settings";
import { textProblemsIn } from "./validate-draft";
import type { Draft } from "./types";

type Admin = SupabaseClient<Database>;

/** Markdown for articles.content_md, assembled from the draft's sections and FAQ. */
export function assembleContentMd(draft: Draft): string {
  const parts: string[] = [];
  for (const s of draft.sections) parts.push(`## ${s.heading}\n\n${s.body_md.trim()}`);
  if (draft.faq.length > 0) {
    parts.push(
      `## Questions people ask\n\n${draft.faq.map((f) => `### ${f.question}\n\n${f.answer_md.trim()}`).join("\n\n")}`,
    );
  }
  return parts.join("\n\n") + "\n";
}

async function loadEdition(admin: Admin, editionId: string) {
  const { data } = await admin
    .from("brief_editions")
    .select("id, article_id, draft_payload, title_choice, season, week, relay_ids")
    .eq("id", editionId)
    .maybeSingle();
  if (!data) return null;
  const { data: article } = await admin
    .from("articles")
    .select("id, slug, title, status")
    .eq("id", data.article_id)
    .maybeSingle();
  if (!article) return null;
  return { edition: data, article };
}

async function snapshotRevision(admin: Admin, articleId: string, title: string, contentMd: string, summary: string) {
  const { data: last } = await admin
    .from("article_revisions")
    .select("revision_number")
    .eq("article_id", articleId)
    .order("revision_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  await admin.from("article_revisions").insert({
    article_id: articleId,
    revision_number: (last?.revision_number ?? 0) + 1,
    title,
    content_md: contentMd,
    tags: [],
    category_id: null,
    source_ingestion_id: null,
    change_summary: summary,
  });
}

export type PublishResult = { ok: true; slug: string } | { ok: false; error: string };

export async function approveEdition(
  admin: Admin,
  input: { editionId: string; reviewedBy: string; postToDiscord: boolean; titleChoice: number | null; notes?: string | null },
): Promise<PublishResult> {
  const loaded = await loadEdition(admin, input.editionId);
  if (!loaded) return { ok: false, error: "Edition not found." };
  const { edition, article } = loaded;
  if (article.status === "published") return { ok: false, error: "This edition is already published." };
  if (article.status !== "in_review") return { ok: false, error: `An edition with status ${article.status} cannot be approved.` };

  const parsed = draftSchema.safeParse(edition.draft_payload);
  if (!parsed.success) return { ok: false, error: "The stored draft no longer parses; reject it and redraft." };
  const draft = parsed.data;

  let title = article.title;
  let slug = article.slug;
  if (draft.title_options && draft.title_options.length > 0) {
    // An integer index into the options, checked as one: a non-integer such
    // as "constructor" indexes Array.prototype, passes a truthiness test, and
    // would publish under the original title before the title_choice write
    // failed.
    const choiceIndex = input.titleChoice;
    if (
      choiceIndex === null ||
      !Number.isInteger(choiceIndex) ||
      choiceIndex < 0 ||
      choiceIndex >= draft.title_options.length
    ) {
      return { ok: false, error: "Pick one of the three titles before approving an off-season edition." };
    }
    const choice = draft.title_options[choiceIndex];
    title = choice.title;
    slug = choice.slug;
    // Both tables, the same pair the validator checked. A Relay permalink lives
    // under /brief/relay/, but the slug columns share one namespace by
    // convention and the validator refuses a clash in either.
    const [{ data: takenArticle }, { data: takenRelay }] = await Promise.all([
      admin.from("articles").select("id").eq("slug", slug).neq("id", article.id).maybeSingle(),
      admin.from("relays").select("id").eq("slug", slug).maybeSingle(),
    ]);
    if (takenArticle) return { ok: false, error: `The slug ${slug} is already taken by another article.` };
    if (takenRelay) return { ok: false, error: `The slug ${slug} is already taken by a Relay.` };
  }

  const now = new Date().toISOString();
  // The guard is the `.eq("status", "in_review")`, and PostgREST returns no
  // error when it matches nothing, so the updated row is selected and zero rows
  // is read as a failure. Without that, a second click walked straight on to
  // stamp relays, revalidate, ping IndexNow and queue the Discord post again.
  const { data: published, error } = await admin
    .from("articles")
    .update({ title, slug, status: "published", published_at: now, last_updated: now })
    .eq("id", article.id)
    .eq("status", "in_review")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!published) {
    return { ok: false, error: "This edition is no longer in review; it was approved or rejected by another action." };
  }

  const fail = async (what: string, message: string) => {
    await logBeaconBrief(admin, {
      stage: "brief_desk",
      level: "error",
      message: `edition ${article.id} published but ${what} failed: ${message}`,
    });
  };

  const { error: editionErr } = await admin
    .from("brief_editions")
    .update({
      title_choice: input.titleChoice,
      reviewed_by: input.reviewedBy,
      reviewed_at: now,
      review_notes: input.notes?.trim() || null,
    })
    .eq("id", edition.id);
  if (editionErr) await fail("the brief_editions review stamp", editionErr.message);

  const citedRelayIds = [...new Set(draft.sections.flatMap((s) => s.relay_ids))];
  if (citedRelayIds.length > 0) {
    const { error: relayErr } = await admin
      .from("relays")
      .update({ brief_id: article.id, updated_at: now })
      .in("id", citedRelayIds);
    if (relayErr) await fail("stamping brief_id on the cited Relays", relayErr.message);
  }

  const { error: modErr } = await admin
    .from("beacon_brief_moderation")
    .update({ status: "approved", resolved_at: now, resolved_by: input.reviewedBy })
    .eq("article_id", article.id)
    .eq("type", "brief_review")
    .eq("status", "pending");
  if (modErr) await fail("resolving the review row", modErr.message);

  revalidateTag("home");
  // The hub, the editions listing and the sitemap index all ask "is any
  // edition published" through one memoised read; the first approval is the
  // moment that answer changes.
  bustMemo(HAS_EDITIONS_MEMO_KEY);
  // after(), not a floating promise: a promise left running when the action's
  // response is sent can be cancelled, and the repo's other IndexNow callers
  // all use after() for exactly that reason.
  after(() => submitIndexNow([`/brief/${slug}`, "/brief", "/brief/editions"]));

  // The checkbox on the review page is a default, never the gate. The server
  // re-reads bd_discord_briefs_enabled here, so a stale page cannot queue a
  // post the owner has switched off.
  const deskSettings = await loadBriefDeskSettings(admin);
  const queueDiscord = input.postToDiscord && deskSettings.discordBriefsEnabled;
  if (queueDiscord) {
    await admin.from("beacon_brief_queue").insert({
      job_type: "discord_post",
      payload: { kind: "brief", article_id: article.id, ingestion_id: "" } as unknown as Json,
      status: "pending",
      run_after: now,
    });
  }

  await logBeaconBrief(admin, {
    stage: "brief_desk",
    level: "info",
    message: `edition approved and published: /brief/${slug}${
      queueDiscord
        ? " (Discord queued)"
        : input.postToDiscord
          ? " (Discord asked for but bd_discord_briefs_enabled is off)"
          : ""
    }`,
  });
  return { ok: true, slug };
}

export async function rejectEdition(
  admin: Admin,
  input: { editionId: string; reviewedBy: string; notes: string },
): Promise<PublishResult> {
  const notes = input.notes.trim();
  if (!notes) return { ok: false, error: "Rejection notes are required; the next draft reads them." };
  const loaded = await loadEdition(admin, input.editionId);
  if (!loaded) return { ok: false, error: "Edition not found." };
  if (loaded.article.status !== "in_review") return { ok: false, error: "Only an edition in review can be rejected." };
  const now = new Date().toISOString();
  const { error } = await admin.from("articles").update({ status: "rejected", last_updated: now }).eq("id", loaded.article.id);
  if (error) return { ok: false, error: error.message };
  await admin
    .from("brief_editions")
    .update({ review_notes: notes, reviewed_by: input.reviewedBy, reviewed_at: now })
    .eq("id", loaded.edition.id);
  await admin
    .from("beacon_brief_moderation")
    .update({ status: "rejected", resolved_at: now, resolved_by: input.reviewedBy })
    .eq("article_id", loaded.article.id)
    .eq("type", "brief_review")
    .eq("status", "pending");
  await logBeaconBrief(admin, { stage: "brief_desk", level: "info", message: `edition rejected: ${loaded.article.slug}` });
  return { ok: true, slug: loaded.article.slug };
}

export async function archiveEdition(admin: Admin, input: { editionId: string; reviewedBy: string }): Promise<PublishResult> {
  const loaded = await loadEdition(admin, input.editionId);
  if (!loaded) return { ok: false, error: "Edition not found." };
  if (loaded.article.status !== "rejected") return { ok: false, error: "Only a rejected edition can be archived." };
  const { error } = await admin
    .from("articles")
    .update({ status: "archived", last_updated: new Date().toISOString() })
    .eq("id", loaded.article.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, slug: loaded.article.slug };
}

export interface EditionTextEdit {
  title?: string;
  meta_description?: string;
  tl_dr?: string;
  /** Section id to new body markdown. */
  sections?: Record<string, string>;
  /** Block id to new caption and conclusion. Data is never editable. */
  blocks?: Record<string, { caption: string; conclusion: string }>;
}

/**
 * Edit an edition's words. The draft payload is the source object, so the
 * edit lands there first and content_md is re-assembled from it; a revision
 * snapshot records the change. Published editions are re-submitted to IndexNow.
 */
export async function updateEditionText(
  admin: Admin,
  input: { editionId: string; reviewedBy: string; edit: EditionTextEdit },
): Promise<PublishResult> {
  const loaded = await loadEdition(admin, input.editionId);
  if (!loaded) return { ok: false, error: "Edition not found." };
  const parsed = draftSchema.safeParse(loaded.edition.draft_payload);
  if (!parsed.success) return { ok: false, error: "The stored draft no longer parses." };
  const draft = parsed.data;
  const e = input.edit;
  if (typeof e.title === "string" && e.title.trim()) draft.title = e.title.trim();
  if (typeof e.meta_description === "string" && e.meta_description.trim()) draft.meta_description = e.meta_description.trim();
  if (typeof e.tl_dr === "string" && e.tl_dr.trim()) draft.tl_dr = e.tl_dr.trim();
  for (const s of draft.sections) {
    const body = e.sections?.[s.id];
    if (typeof body === "string" && body.trim()) s.body_md = body;
  }
  for (const b of draft.blocks) {
    const text = e.blocks?.[b.id];
    if (text) {
      b.caption = text.caption.slice(0, 300);
      b.conclusion = text.conclusion.slice(0, 300);
    }
  }
  const check = draftSchema.safeParse(draft);
  if (!check.success) return { ok: false, error: check.error.issues.map((i) => i.message).join("; ") };

  // The same banned-character, banned-phrase and raw-HTML check the validator
  // ran on the draft. An edit rewrites exactly the strings that check covered,
  // and this one goes straight to a published page.
  const problems: string[] = [
    ...textProblemsIn(draft.title, "title"),
    ...textProblemsIn(draft.meta_description, "meta_description"),
    ...textProblemsIn(draft.tl_dr, "tl_dr"),
    ...draft.sections.flatMap((s) => textProblemsIn(s.body_md, `section "${s.id}" body`)),
    ...draft.blocks.flatMap((b) => [
      ...textProblemsIn(b.caption, `block "${b.id}" caption`),
      ...textProblemsIn(b.conclusion, `block "${b.id}" conclusion`),
    ]),
  ];
  if (problems.length > 0) return { ok: false, error: problems.join("; ") };

  const now = new Date().toISOString();
  const contentMd = assembleContentMd(draft);
  const { error } = await admin
    .from("articles")
    .update({ title: draft.title, meta_description: draft.meta_description, tl_dr: draft.tl_dr, content_md: contentMd, last_updated: now })
    .eq("id", loaded.article.id);
  if (error) return { ok: false, error: error.message };
  await admin.from("brief_editions").update({ draft_payload: draft as unknown as Json }).eq("id", loaded.edition.id);
  await snapshotRevision(admin, loaded.article.id, draft.title, contentMd, "Owner edit from the review page");
  if (loaded.article.status === "published") {
    after(() => submitIndexNow([`/brief/${loaded.article.slug}`]));
  }
  return { ok: true, slug: loaded.article.slug };
}
