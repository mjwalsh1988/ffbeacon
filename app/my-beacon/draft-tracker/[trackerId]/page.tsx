import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAvailableSources, resolveSourceForFormat } from "@/lib/source";
import { resolveSourceSlug } from "@/lib/preferences";
import { Panel } from "@/components/dashboard-panel";
import { SetBreadcrumbLabel } from "@/components/app-shell/breadcrumb-label";
import { loadTracker } from "@/lib/draft-tracker/store";
import { loadDraftTrackerBoard } from "@/lib/draft-tracker/board";
import { DraftRoom } from "./draft-room";

export const metadata: Metadata = {
  title: "Draft board",
  description: "Your manual draft board: who is left, and who has already gone.",
};

/**
 * /my-beacon/draft-tracker/[trackerId]
 *
 * The board. Two reads: the tracker with its picks (live, never cached, because
 * a pick a second ago has to be gone from the list), and the ranked board for
 * the tracker's format and the reader's source (cached, because it is the same
 * for everybody and changes overnight).
 *
 * FORMAT AND SOURCE, and why they are resolved differently. The format is the
 * tracker's own, chosen when the draft was set up: the header's format toggle
 * has no effect in here, the same way it has none inside a league view. The
 * source IS the reader's, because it only changes whose value opinion is shown
 * and switching it mid draft costs nothing. When the reader's source does not
 * publish this format we fall through to one that does and say so on the page
 * rather than showing a board with no numbers on it.
 */
export default async function DraftBoardPage({
  params,
}: {
  params: Promise<{ trackerId: string }>;
}) {
  const { trackerId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // A layout and its page render concurrently, so the layout's redirect cannot
  // be relied on to have happened yet.
  if (!user) redirect(`/login?next=/my-beacon/draft-tracker/${trackerId}`);

  // Row level security scopes this to the signed-in reader, so a tracker
  // belonging to somebody else is indistinguishable from one that never existed.
  const loaded = await loadTracker(supabase, trackerId);
  if (!loaded) notFound();
  const { tracker, picks } = loaded;

  const [sources, sourceRes] = await Promise.all([
    getAvailableSources(supabase),
    resolveSourceSlug(supabase, undefined),
  ]);

  const resolved = resolveSourceForFormat(
    sources,
    "rankings",
    tracker.formatSlug,
    sourceRes.slug,
  );
  const requestedLabel =
    sources.find((s) => s.slug === sourceRes.slug)?.display_name ?? null;
  const sourceLabel =
    sources.find((s) => s.slug === resolved.source)?.display_name ?? "No source";

  // Nothing publishes this format: render the honest empty state rather than an
  // empty table with a filter box on top of it.
  if (!resolved.source) {
    return (
      <div className="space-y-6">
        <SetBreadcrumbLabel value={tracker.name} />
        <BackLink />
        <Panel
          eyebrow="Draft Tracker"
          title={tracker.name}
          helper={tracker.formatLabel}
          headingLevel={2}
        >
          <p className="text-sm leading-relaxed text-ink-muted">
            No source publishes player values for {tracker.formatLabel} right
            now, so there is no list to draft from. Start a draft on another
            format and this one will still be here.
          </p>
        </Panel>
      </div>
    );
  }

  const board = await loadDraftTrackerBoard({
    formatConfigId: tracker.formatConfigId,
    formatSlug: tracker.formatSlug,
    formatLabel: tracker.formatLabel,
    sourceSlug: resolved.source,
    sourceLabel,
  });

  // The reader asked for a source that does not cover this draft's format. Say
  // which one we used instead. The swap is not persisted anywhere: their saved
  // preference is untouched.
  const sourceFallback =
    resolved.source !== sourceRes.slug && requestedLabel
      ? { from: requestedLabel, to: sourceLabel }
      : null;

  return (
    <div className="space-y-6">
      {/* Without this the trail reads the raw uuid, split on its hyphens and
          capitalised. */}
      <SetBreadcrumbLabel value={tracker.name} />
      <BackLink />
      <DraftRoom
        tracker={tracker}
        board={board}
        initialPicks={picks}
        sourceFallback={sourceFallback}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/my-beacon/draft-tracker"
      className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-cyan transition-colors hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
    >
      <ArrowLeft aria-hidden="true" className="h-4 w-4" />
      All saved drafts
    </Link>
  );
}
