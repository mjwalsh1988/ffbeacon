import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardList, ListChecks, Plus, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatEastern } from "@/lib/datetime";
import { Panel } from "@/components/dashboard-panel";
import { listTrackers } from "@/lib/draft-tracker/store";
import { teamLabel } from "@/lib/draft-tracker/order";
import { SavedDraftsList, type SavedDraftRow } from "./saved-drafts-list";

export const metadata: Metadata = {
  title: "Draft Tracker",
  description:
    "Track a draft we cannot see. Cross players off as they go, in person or on any other platform, and keep every roster in front of you.",
};

/**
 * /my-beacon/draft-tracker
 *
 * The front door: what this is, one button to start, and the drafts already
 * saved. The setup questions used to be expanded right here, which meant the
 * page opened with a dozen controls and no clear first move. They live at
 * /my-beacon/draft-tracker/new now, one at a time.
 *
 * The name is deliberately plain. Somebody arriving from the dashboard has to
 * understand what it does without a glossary: it tracks a draft. On The Clock is
 * the room for a Sleeper draft we can read live; this is the pad of paper for
 * one we cannot.
 */
export default async function DraftTrackerPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/my-beacon/draft-tracker");

  const trackers = await listTrackers(supabase, user.id);

  const drafts: SavedDraftRow[] = trackers.map((tracker) => ({
    id: tracker.id,
    name: tracker.name,
    formatLabel: tracker.formatLabel,
    teamsLine:
      tracker.trackingMode === "all"
        ? `${tracker.teamCount} teams, you are ${teamLabel(tracker.teamNames, tracker.myTeamSlot)}`
        : `${tracker.teamCount} teams, tracking your own`,
    countsLine: `${tracker.pickCount} off the board, ${tracker.myPickCount} on your team.`,
    lastTouched: formatEastern(tracker.updatedAt),
    isComplete: tracker.status === "complete",
  }));

  return (
    <div className="space-y-6">
      <Panel
        eyebrow="Draft Tracker"
        title="Track a draft we cannot see."
        helper="For a draft in a room, or on a site we do not connect to yet."
        headingLevel={2}
        glow
      >
        <p className="text-sm leading-relaxed text-ink-muted">
          You get one long list of players in whatever order you want them. Tap a
          player to take him for your team, or mark him gone when somebody else
          does. Nothing here talks to Sleeper, so it works at a kitchen table
          just as well as on another site.
        </p>

        <Link
          href="/my-beacon/draft-tracker/new"
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-card bg-beacon px-5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Set up a draft
        </Link>
        <p className="mt-2 text-xs text-ink-subtle">
          Four short questions, one at a time. It saves as you answer, so you can
          come back to it.
        </p>

        <ul className="mt-5 grid gap-2 border-t border-line pt-4 sm:grid-cols-3">
          <HowItWorks
            icon={ListChecks}
            title="One list, your order"
            body="Our value, the market's ADP, or plain A to Z."
          />
          <HowItWorks
            icon={Users}
            title="One team or all of them"
            body="Track just your roster, or every manager in the room."
          />
          <HowItWorks
            icon={ClipboardList}
            title="Undo any tap"
            body="A wrong player comes straight back to the board."
          />
        </ul>
      </Panel>

      <SavedDraftsList drafts={drafts} />
    </div>
  );
}

function HowItWorks({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof ListChecks;
  title: string;
  body: string;
}) {
  return (
    <li className="rounded-card border border-line bg-base/40 p-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-brand-cyan" />
        {title}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{body}</p>
    </li>
  );
}
