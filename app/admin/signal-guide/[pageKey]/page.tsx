import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import {
  GuideEntriesManager,
  GuidePageMetaForm,
} from "@/components/admin/guide-entries-manager";
import { GuideSubmissionAcceptForm } from "@/components/admin/guide-submission-accept-form";
import type { GuideEntry, GuideEntryKind } from "@/lib/guide/types";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ pageKey: string }>;
}): Promise<Metadata> {
  const { pageKey } = await params;
  // guide_pages is public-read, so the publishable client suffices here. This
  // avoids touching the service-role client outside an admin gate (the page
  // component below is the gated render path).
  const supabase = await createClient();
  const { data: page } = await supabase
    .from("guide_pages")
    .select("title")
    .eq("page_key", pageKey)
    .maybeSingle();
  return { title: page ? `${page.title} | Signal Guide` : "Signal Guide" };
}

/**
 * Manage one page's Signal Guide content: edit the page's title/description and
 * add/edit/reorder/publish/delete its questions and terms. Reads via the
 * service-role client so unpublished entries are visible to the admin.
 */
function toEntry(r: {
  id: string;
  page_id: string;
  kind: string;
  heading: string;
  body: string;
  display_order: number;
  is_published: boolean;
  is_global: boolean;
}): GuideEntry {
  return {
    id: r.id,
    page_id: r.page_id,
    kind: r.kind as GuideEntryKind,
    heading: r.heading,
    body: r.body,
    display_order: r.display_order,
    is_published: r.is_published,
    is_global: r.is_global,
  };
}

const ENTRY_COLUMNS =
  "id, page_id, kind, heading, body, display_order, is_published, is_global";

export default async function AdminSignalGuidePageManage({
  params,
  searchParams,
}: {
  params: Promise<{ pageKey: string }>;
  searchParams: Promise<{ submission?: string }>;
}) {
  const { pageKey } = await params;
  const { submission: submissionId } = await searchParams;
  await requireAdmin(`/admin/signal-guide/${pageKey}`);

  const admin = createAdminClient();
  const { data: page } = await admin
    .from("guide_pages")
    .select("id, page_key, title, description, route_example")
    .eq("page_key", pageKey)
    .maybeSingle();
  if (!page) notFound();

  // Page-specific entries (this page only) and global entries (shown everywhere)
  // are managed in separate sections. Also load the page list for the accept form's
  // destination picker, and the in-flight submission when accepting one.
  const [{ data: ownRows }, { data: globalRows }, { data: allPages }, { data: pendingSub }] =
    await Promise.all([
      admin
        .from("guide_entries")
        .select(ENTRY_COLUMNS)
        .eq("page_id", page.id)
        .eq("is_global", false)
        .order("display_order", { ascending: true })
        .order("created_at", { ascending: true }),
      admin
        .from("guide_entries")
        .select(ENTRY_COLUMNS)
        .eq("is_global", true)
        .order("display_order", { ascending: true })
        .order("created_at", { ascending: true }),
      admin
        .from("guide_pages")
        .select("page_key, title")
        .order("display_order", { ascending: true })
        .order("title", { ascending: true }),
      submissionId
        ? admin
            .from("guide_question_submissions")
            .select("id, name, email, question, status")
            .eq("id", submissionId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const ownEntries = (ownRows ?? []).map(toEntry);
  const globalEntries = (globalRows ?? []).map(toEntry);

  const questions = ownEntries.filter((e) => e.kind === "question");
  const terms = ownEntries.filter((e) => e.kind === "term");
  const globalQuestions = globalEntries.filter((e) => e.kind === "question");
  const globalTerms = globalEntries.filter((e) => e.kind === "term");

  // Only surface the accept form for a submission that is still pending.
  const acceptSubmission =
    pendingSub && pendingSub.status === "pending" ? pendingSub : null;

  return (
    <div>
      <Link
        href="/admin/signal-guide"
        className="inline-flex items-center gap-1 text-sm font-semibold text-brand-cyan hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Back to Signal Guide
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
        {page.title}
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
        Manage the help shown on{" "}
        <span className="font-mono text-ink">{page.route_example ?? page.page_key}</span>.
        Questions appear under "Understand the Signal"; terms appear under "Metrics &amp;
        Terms Decoded". Unpublished entries stay hidden from visitors.
      </p>

      <div className="mt-8 space-y-10">
        {acceptSubmission && (
          <GuideSubmissionAcceptForm
            submissionId={acceptSubmission.id}
            submitterName={acceptSubmission.name}
            submitterEmail={acceptSubmission.email}
            questionText={acceptSubmission.question}
            defaultPageKey={page.page_key}
            pages={allPages ?? [{ page_key: page.page_key, title: page.title }]}
          />
        )}

        <GuidePageMetaForm
          pageKey={page.page_key}
          initialTitle={page.title}
          initialDescription={page.description ?? ""}
        />

        <GuideEntriesManager pageKey={page.page_key} kind="question" initial={questions} />
        <GuideEntriesManager pageKey={page.page_key} kind="term" initial={terms} />

        {(globalQuestions.length > 0 || globalTerms.length > 0) && (
          <div className="space-y-10 rounded-modal border border-brand-purple/30 bg-brand-purple/5 p-4 sm:p-5">
            <div>
              <h2 className="text-lg font-semibold text-ink">Global guide content</h2>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">
                Shown in the guide on every page, including this one. Changes here affect
                all pages.
              </p>
            </div>
            <GuideEntriesManager
              pageKey={page.page_key}
              kind="question"
              initial={globalQuestions}
              scope="global"
            />
            <GuideEntriesManager
              pageKey={page.page_key}
              kind="term"
              initial={globalTerms}
              scope="global"
            />
          </div>
        )}
      </div>
    </div>
  );
}
