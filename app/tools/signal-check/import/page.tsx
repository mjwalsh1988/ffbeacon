import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listImportLeagues } from "./actions";
import { ImportWizard, NeedsUsername } from "./import-wizard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Import a Sleeper trade | Signal Check",
  description: "Import a completed Sleeper trade and get the Beacon Verdict.",
  robots: { index: false },
};

export default async function SignalCheckImportPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/tools/signal-check/import");
  }

  const result = await listImportLeagues();

  return (
    <main id="main">
      <header className="relative overflow-hidden border-b border-line">
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px"
          style={{
            backgroundImage:
              "linear-gradient(90deg, transparent 0%, #A855F7 35%, #22D3EE 65%, transparent 100%)",
          }}
        />
        <div className="relative mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-14 lg:px-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
            Signal Check · Sleeper import
          </p>
          <h1 className="mt-2 text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl">
            Import a completed Sleeper trade
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-muted">
            Pick one of your Sleeper leagues and a completed trade. We detect the league format
            automatically and return the Beacon Verdict. Your league and team details stay private
            unless you choose to share a result.
          </p>
        </div>
      </header>

      <section aria-labelledby="import-heading" className="border-b border-line">
        <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
          <h2 id="import-heading" className="sr-only">
            Import wizard
          </h2>
          {result.ok ? (
            result.leagues.length === 0 ? (
              <p role="status" className="rounded-card border border-line bg-surface/40 p-6 text-sm text-ink-muted">
                No active leagues found for {result.username} this season.
              </p>
            ) : (
              <ImportWizard initialLeagues={result.leagues} />
            )
          ) : result.needsUsername ? (
            <NeedsUsername message={result.error} />
          ) : (
            <p role="alert" className="rounded-card border border-signal-danger/40 bg-signal-danger/10 p-4 text-sm text-signal-danger">
              {result.error}
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
