import type { Metadata } from "next";
import Link from "next/link";
import { Gauge, LogIn, UserPlus } from "lucide-react";
import { pageShareMetadata } from "@/lib/page-og";
import { createClient } from "@/lib/supabase/server";
import { loadSavedSleeperHandle } from "@/lib/sleeper-handle/resolve";
import { SleeperIdentityCard } from "@/components/sleeper-handle/identity-card";
import { PageBody } from "@/components/app-shell/page-body";
import { PageColumns } from "@/components/app-shell/page-columns";
import { PageMasthead } from "@/components/app-shell/page-masthead";
import { listRecentLookups } from "@/lib/manager-pulse/service";
import { RecentLookups } from "@/components/manager-pulse/recent-lookups";
import { WhatYouGet } from "@/components/manager-pulse/what-you-get";
import { ManagerSearchForm } from "./manager-search-form";
// components/manager-pulse/sample-report.tsx (Wave 4, C4): the guest sample,
// the same report components at full fidelity, fenced with the Sample badge
// and caption rules from docs/manager-pulse/manager-pulse-plan.md 7.3. Takes no props.
import { SampleManagerReport } from "@/components/manager-pulse/sample-report";

export const metadata: Metadata = {
  alternates: { canonical: "/tools/manager-pulse" },
  title: "Manager Pulse: Know Who You're Trading With",
  description:
    "Type a Sleeper handle and see how a manager actually plays: what they win, how they draft, who they keep buying, and what they overpay for.",
  ...pageShareMetadata({
    key: "manager-pulse",
    title: "Manager Pulse: Know Who You're Trading With",
    description:
      "Type a Sleeper handle and see how a manager actually plays: what they win, how they draft, who they keep buying, and what they overpay for.",
    path: "/tools/manager-pulse",
  }),
};

export const dynamic = "force-dynamic";

export default async function ManagerPulsePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The reader's own saved Sleeper identity, through the one resolver.
  //
  // It is NOT used to prefill the search box. This tool exists to look up OTHER
  // managers, and a field that opens holding the reader's own handle turns the
  // most common action (type a rival's handle) into "clear this, then type".
  // It buys the card above the form instead, whose one button is the reader's
  // own report (D9).
  let saved: Awaited<ReturnType<typeof loadSavedSleeperHandle>> = null;
  // The reader's own recent lookups, so the entry page is a way back into a
  // report as well as a way into a new one. Every one of these is warm in the
  // report cache, so following one costs no Sleeper traffic. Owner-scoped by
  // RLS AND filtered on the user id, and it never throws.
  let recent: Awaited<ReturnType<typeof listRecentLookups>> = [];
  if (user) {
    const [handle, lookups] = await Promise.all([
      loadSavedSleeperHandle(supabase),
      listRecentLookups(supabase, user.id),
    ]);
    saved = handle;
    recent = lookups;
  }

  // SIGNED IN: the form and the reader's history in the main column, what the
  // report contains in the rail. The page used to be one input field alone in
  // the middle of an empty screen, which told a reader nothing about what
  // typing a stranger's handle into it would produce.
  if (user) {
    return (
      <main id="main">
        <PageMasthead
          eyebrow="Tools"
          title="Manager Pulse"
          description="Type a Sleeper handle and see how a manager actually plays: what they win, how they draft, and what they overpay for."
        />
        <PageColumns
          railLabel="What a Manager Pulse report contains"
          rail={<WhatYouGet />}
        >
          {saved && (
            <SleeperIdentityCard
              toolName="Manager Pulse"
              handle={saved}
              headingLevel={2}
              compact
              className="mb-3"
              actions={
                <Link
                  href={`/tools/manager-pulse/${encodeURIComponent(
                    saved.username.trim().toLowerCase(),
                  )}`}
                  className="inline-flex h-11 min-h-11 items-center gap-1.5 rounded-card bg-beacon px-4 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  <Gauge aria-hidden="true" className="h-4 w-4" />
                  Open my own report
                </Link>
              }
            />
          )}
          <section aria-label="Look up a manager">
            <ManagerSearchForm />
          </section>
          {!saved && <SaveHandleHint />}
          <RecentLookups lookups={recent} />
        </PageColumns>
      </main>
    );
  }

  return (
    <main id="main">
      <PageBody>
        <PageMasthead
          eyebrow="Tools"
          title="Manager Pulse"
          description="Type a Sleeper handle and see how a manager actually plays: what they win, how they draft, and what they overpay for."
        />

        {/* SignInCta carries its own <h2>, so this section is labelled by that
            heading rather than a second, redundant one wrapping it. */}
        <section aria-labelledby="mp-signin-heading" className="mt-8">
          <div className="mx-auto max-w-2xl">
            <SignInCta />
          </div>
        </section>

        <section aria-labelledby="mp-sample-heading" className="mt-12">
          <h2
            id="mp-sample-heading"
            className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl"
          >
            What a report looks like
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-ink-muted">
            Made-up numbers on a made-up manager, so you can see the shape of a
            real one before you sign in.
          </p>
          <div className="mt-6">
            <SampleManagerReport />
          </div>
        </section>
      </PageBody>
    </main>
  );
}

/**
 * The one sentence for a signed-in reader who has saved no handle.
 *
 * Deliberately NOT the shared `SaveHandleNotice`. Its "member-unsaved" wording
 * points at a save checkbox in the form directly above it, and the form above
 * this one has none: Manager Pulse takes somebody else's handle and saves
 * nothing. So this points at the page that does the saving, and the visual
 * treatment is the notice's so the two read as the same kind of aside.
 */
function SaveHandleHint() {
  return (
    <p className="mt-6 flex items-start gap-2.5 rounded-card border border-line bg-base/50 p-3 text-sm leading-relaxed text-ink-muted">
      <UserPlus
        aria-hidden="true"
        className="mt-0.5 h-4 w-4 shrink-0 text-brand-cyan"
      />
      <span>
        <Link
          href="/my-beacon/sleeper-leagues"
          className="font-medium text-brand-purple underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        >
          Save your Sleeper username in My Beacon
        </Link>{" "}
        and this page will offer your own report in one press.
      </span>
    </p>
  );
}

function SignInCta() {
  const next = encodeURIComponent("/tools/manager-pulse");
  return (
    <div className="relative overflow-hidden rounded-modal border border-brand-purple/30 bg-surface p-6 text-center sm:p-8">
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
        }}
      />
      <h2
        id="mp-signin-heading"
        className="text-xl font-semibold tracking-tight text-ink"
      >
        Sign in to look someone up.
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-muted">
        A Manager Pulse report reads several seasons of a real person&apos;s
        Sleeper history, so this one tool needs an account. Everything else on
        FF Beacon stays open.
      </p>
      <div className="mt-5 flex flex-col items-center justify-center gap-2.5 sm:flex-row">
        <Link
          href={`/login?next=${next}`}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-card bg-beacon px-5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:w-auto"
        >
          <LogIn aria-hidden="true" className="h-4 w-4" />
          Sign in
        </Link>
        <Link
          href={`/login?next=${next}`}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-card border border-line bg-base px-5 text-sm font-semibold text-ink transition-colors hover:border-brand-cyan/60 hover:text-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:w-auto"
        >
          <UserPlus aria-hidden="true" className="h-4 w-4" />
          Sign in or register
        </Link>
      </div>
    </div>
  );
}
