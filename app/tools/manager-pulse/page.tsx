import type { Metadata } from "next";
import Link from "next/link";
import { LogIn, UserPlus } from "lucide-react";
import { pageShareMetadata } from "@/lib/page-og";
import { createClient } from "@/lib/supabase/server";
import { parseSleeperLeagueSettings } from "@/lib/sleeper-league-settings";
import { PageBody } from "@/components/app-shell/page-body";
import { PageMasthead } from "@/components/app-shell/page-masthead";
import { ManagerSearchForm } from "./manager-search-form";
// components/manager-pulse/sample-report.tsx (Wave 4, C4): the guest sample,
// the same report components at full fidelity, fenced with the Sample badge
// and caption rules from docs/manager-pulse-plan.md 7.3. Takes no props.
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

  let defaultHandle = "";
  if (user) {
    const { data: prefs } = await supabase
      .from("user_preferences")
      .select("sleeper_league_settings")
      .eq("user_id", user.id)
      .maybeSingle();
    defaultHandle = parseSleeperLeagueSettings(prefs?.sleeper_league_settings).username ?? "";
  }

  return (
    <main id="main">
      <PageBody>
        <PageMasthead
          eyebrow="Tools"
          title="Manager Pulse"
          description="Type a Sleeper handle and see how a manager actually plays: what they win, how they draft, and what they overpay for."
        />

        {user ? (
          <section aria-label="Look up a manager" className="mt-8">
            <div className="mx-auto max-w-2xl">
              <ManagerSearchForm defaultHandle={defaultHandle} />
            </div>
          </section>
        ) : (
          // SignInCta carries its own <h2>, so this section is labelled by
          // that heading rather than a second, redundant one wrapping it.
          <section aria-labelledby="mp-signin-heading" className="mt-8">
            <div className="mx-auto max-w-2xl">
              <SignInCta />
            </div>
          </section>
        )}

        {!user && (
          <section aria-labelledby="mp-sample-heading" className="mt-12">
            <h2
              id="mp-sample-heading"
              className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl"
            >
              What a report looks like
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-ink-muted">
              Made-up numbers on a made-up manager, so you can see the shape of
              a real one before you sign in.
            </p>
            <div className="mt-6">
              <SampleManagerReport />
            </div>
          </section>
        )}
      </PageBody>
    </main>
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
      <h2 id="mp-signin-heading" className="text-xl font-semibold tracking-tight text-ink">
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
