import type { Metadata } from "next";
import Link from "next/link";
import { Scale, ShieldCheck, ListTree } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { loadSignalCheckSettings } from "@/lib/signal-check/settings";
import { supportedFormats } from "@/lib/signal-check/format";
import { SignalCheckBuilder, type FormatOption } from "./signal-check-builder";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Signal Check Trade Analyzer",
  description:
    "Build a fantasy football trade and get the Beacon Verdict: who wins, by how much, and why, powered by FF Beacon Values.",
};

export default async function SignalCheckPage() {
  const admin = createAdminClient();
  const settings = await loadSignalCheckSettings(admin);
  const formatRows = settings.enabled ? await supportedFormats(admin, settings) : [];
  const formats: FormatOption[] = formatRows.map((f) => ({
    slug: f.slug,
    display: f.display,
    leagueType: f.leagueType,
    allowsPicks: f.allowsPicks,
  }));

  return (
    <main id="main">
      <Hero featureLabel={settings.publicLabel} resultLabel={settings.resultLabel} />

      <section aria-labelledby="builder-heading" className="border-b border-line">
        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
          <h2 id="builder-heading" className="sr-only">
            Build a trade
          </h2>

          {!settings.enabled || formats.length === 0 ? (
            <p
              role="status"
              className="rounded-card border border-line bg-surface/40 p-6 text-sm text-ink-muted"
            >
              {settings.publicLabel} is not available right now. Please check back soon.
            </p>
          ) : (
            <SignalCheckBuilder
              formats={formats}
              defaultFormatSlug={settings.defaultFormatSlug}
              minLength={settings.autocompleteMinLength}
            />
          )}
        </div>
      </section>
    </main>
  );
}

function Hero({ featureLabel, resultLabel }: { featureLabel: string; resultLabel: string }) {
  return (
    <header className="relative overflow-hidden border-b border-line">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 35%, #22D3EE 65%, transparent 100%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/2 h-[360px] w-[820px] -translate-x-1/2"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(168, 85, 247, 0.16) 0%, rgba(34, 211, 238, 0.08) 45%, transparent 75%)",
        }}
      />
      <div className="relative mx-auto max-w-5xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
          Tools · {featureLabel}
        </p>
        <h1
          aria-label={`${featureLabel}: the FF Beacon trade analyzer`}
          className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl"
        >
          {featureLabel}:{" "}
          <span
            className="bg-clip-text text-transparent"
            style={{ backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)" }}
          >
            the {resultLabel}, explained.
          </span>
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-ink-muted sm:text-lg">
          Add players and draft picks to each side. {featureLabel} weighs them with FF Beacon
          Values for your league format and returns the {resultLabel}: who wins, the margin, and a
          plain-language reason, with no guesswork.
        </p>

        <ul role="list" aria-label="How Signal Check works" className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          <HeroBullet icon={Scale} title="FF Beacon Values" body="One trusted value scale, weighted for your format." />
          <HeroBullet icon={ListTree} title="Transparent reasons" body="Every adjustment is traced, not hand-waved." />
          <HeroBullet icon={ShieldCheck} title="Shareable verdicts" body="Freeze a result and share a clean public link." />
        </ul>

        <p className="mt-6 text-sm text-ink-muted">
          Have a Sleeper league?{" "}
          <Link href="/my-beacon/sleeper-leagues" className="text-brand-purple underline-offset-4 hover:underline">
            Sign in to import a completed trade
          </Link>
          .
        </p>
      </div>
    </header>
  );
}

function HeroBullet({ icon: Icon, title, body }: { icon: typeof Scale; title: string; body: string }) {
  return (
    <li className="rounded-card border border-line bg-surface/60 p-4">
      <span
        aria-hidden="true"
        className="flex h-9 w-9 items-center justify-center rounded-card border border-line bg-base text-brand-cyan"
      >
        <Icon className="h-4 w-4" />
      </span>
      <p className="mt-3 text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{body}</p>
    </li>
  );
}
