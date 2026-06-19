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
export default async function AdminSignalGuidePageManage({
  params,
}: {
  params: Promise<{ pageKey: string }>;
}) {
  const { pageKey } = await params;
  await requireAdmin(`/admin/signal-guide/${pageKey}`);

  const admin = createAdminClient();
  const { data: page } = await admin
    .from("guide_pages")
    .select("id, page_key, title, description, route_example")
    .eq("page_key", pageKey)
    .maybeSingle();
  if (!page) notFound();

  const { data: rows } = await admin
    .from("guide_entries")
    .select("id, page_id, kind, heading, body, display_order, is_published")
    .eq("page_id", page.id)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });

  const entries: GuideEntry[] = (rows ?? []).map((r) => ({
    id: r.id,
    page_id: r.page_id,
    kind: r.kind as GuideEntryKind,
    heading: r.heading,
    body: r.body,
    display_order: r.display_order,
    is_published: r.is_published,
  }));

  const questions = entries.filter((e) => e.kind === "question");
  const terms = entries.filter((e) => e.kind === "term");

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
        <GuidePageMetaForm
          pageKey={page.page_key}
          initialTitle={page.title}
          initialDescription={page.description ?? ""}
        />

        <GuideEntriesManager
          pageKey={page.page_key}
          kind="question"
          initial={questions}
        />
        <GuideEntriesManager pageKey={page.page_key} kind="term" initial={terms} />
      </div>
    </div>
  );
}
