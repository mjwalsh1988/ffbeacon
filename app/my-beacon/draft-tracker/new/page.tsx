import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getActiveFormats, getAvailableSources, resolveSourceForFormat } from "@/lib/source";
import { resolveFormatSlug, resolveSourceSlug } from "@/lib/preferences";
import { DraftWizard, type FormatChoice } from "./draft-wizard";

export const metadata: Metadata = {
  title: "Set up a draft",
  description:
    "Answer four short questions and get a draft board you can cross players off by hand.",
};

/**
 * /my-beacon/draft-tracker/new
 *
 * The setup wizard gets its own route rather than sitting expanded on the list
 * page. That is what lets the list page open with one obvious thing to do, and
 * it means browser Back abandons a setup the way a reader expects.
 *
 * A static segment beats a dynamic one in the App Router, so this does not
 * collide with /my-beacon/draft-tracker/[trackerId].
 */
export default async function NewDraftPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // A layout and its page render concurrently, so the layout's redirect cannot
  // be relied on to have happened yet.
  if (!user) redirect("/login?next=/my-beacon/draft-tracker/new");

  const [formats, sources, formatRes, sourceRes] = await Promise.all([
    getActiveFormats(supabase),
    getAvailableSources(supabase),
    resolveFormatSlug(supabase, undefined),
    resolveSourceSlug(supabase, undefined),
  ]);

  const formatChoices: FormatChoice[] = formats.map((f) => ({
    slug: f.slug,
    label: f.display_name,
  }));
  // The reader's saved format is only the starting selection: a draft runs under
  // the rules of the room they are sitting in, which is often not the format
  // they usually browse.
  const defaultFormatSlug =
    formatChoices.find((f) => f.slug === formatRes.slug)?.slug ??
    formatChoices[0]?.slug ??
    "";

  // Which source actually backs each format, resolved per format rather than
  // once, so the ordering step never names a source the board will not use.
  const sourceLabelByFormat: Record<string, string> = {};
  for (const format of formats) {
    const resolved = resolveSourceForFormat(sources, "rankings", format.slug, sourceRes.slug);
    sourceLabelByFormat[format.slug] =
      sources.find((s) => s.slug === resolved.source)?.display_name ?? "your source";
  }

  return (
    <div className="space-y-6">
      <Link
        href="/my-beacon/draft-tracker"
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-cyan transition-colors hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        All saved drafts
      </Link>

      <DraftWizard
        formats={formatChoices}
        defaultFormatSlug={defaultFormatSlug}
        sourceLabelByFormat={sourceLabelByFormat}
      />
    </div>
  );
}
