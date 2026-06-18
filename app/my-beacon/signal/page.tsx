import type { Metadata } from "next";
import Link from "next/link";
import {
  Radio,
  Users,
  AtSign,
  IdCard,
  LayoutPanelTop,
  Globe,
  ArrowRight,
  Check,
  CircleDashed,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  loadOwnerSignal,
  computeStepCompletion,
  type OwnerSignal,
  type StepCompletion,
} from "@/lib/signal/editor-data";
import {
  SIGNAL_SUBPAGES,
  type SignalSubpage,
} from "@/lib/signal/editor-nav";
import { SignalEditorSubNav } from "@/components/signal/signal-editor-subnav";
import { HandleManager } from "./handle-manager";

export const metadata: Metadata = {
  title: "My Signal",
  description:
    "Set up your public FF Beacon creator profile: claim a handle, build it out step by step, and publish when you are ready.",
};

export default async function MySignalPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const signal = await loadOwnerSignal(supabase, user!.id);

  // No handle yet: the only thing to do is claim one. Nothing else is shown
  // until a Signal exists.
  if (!signal) return <ClaimView />;

  const steps = await computeStepCompletion(supabase, user!.id, signal);
  const launched = signal.published_at !== null;

  return launched ? (
    <HubGrid signal={signal} steps={steps} />
  ) : (
    <WizardView steps={steps} />
  );
}

/* ---------- State 1: claim ---------- */

function ClaimView() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Intro: branded header card so the page opens with a clear anchor
          instead of loose text. */}
      <section
        aria-labelledby="signal-claim-intro"
        className="relative overflow-hidden rounded-modal border border-line bg-surface/60 p-6 sm:p-7"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{
            backgroundImage:
              "linear-gradient(90deg, transparent 0%, #A855F7 35%, #22D3EE 65%, transparent 100%)",
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-20 -top-20 h-48 w-48 rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(168, 85, 247, 0.14) 0%, transparent 70%)",
          }}
        />
        <div className="relative">
          <div className="flex items-center gap-3">
            <ClaimEmblem />
            <SectionEyebrow>My Signal</SectionEyebrow>
          </div>
          <h2
            id="signal-claim-intro"
            className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl"
          >
            Ready to boost your signal?
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-muted">
            Your Signal is your home base on FF Beacon: one shareable page that
            pulls your rankings, leagues, links, and a Wall together so you can
            boost your signal and grow your audience. Claiming your handle is the
            first step, and nothing goes public until you hit publish.
          </p>

          <ul role="list" className="mt-6 grid gap-3 sm:grid-cols-2">
            <ClaimPoint
              icon={Radio}
              title="For creators"
              body="Showcase your boards and leagues, link your channels, and boost your signal to a following."
            />
            <ClaimPoint
              icon={Users}
              title="For everyone"
              body="Get a public profile so people can follow you and join the conversation on your Wall."
            />
          </ul>
        </div>
      </section>

      {/* Step 1: the claim panel, highlighted so it reads as the action. */}
      <section
        id="claim-handle"
        aria-labelledby="signal-claim-heading"
        className="scroll-mt-24 rounded-modal border border-brand-purple/40 bg-brand-purple/[0.05] p-6 sm:p-7"
      >
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card border border-brand-purple/40 bg-base text-brand-purple"
          >
            <AtSign className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-purple">
              Step 1
            </p>
            <h2
              id="signal-claim-heading"
              className="text-lg font-semibold tracking-tight text-ink"
            >
              Claim your handle
            </h2>
          </div>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          This is your public address, the short link you hand out to boost your
          signal. It cannot be one of our reserved words, and you can change it
          once every 30 days.
        </p>
        <div className="mt-4">
          <HandleManager currentHandle={null} />
        </div>
      </section>

      {/* What comes after, so the single step has context. */}
      <section aria-labelledby="signal-next-heading">
        <div className="flex items-center gap-2">
          <Sparkles aria-hidden="true" className="h-4 w-4 text-brand-purple" />
          <h2
            id="signal-next-heading"
            className="text-lg font-semibold tracking-tight text-ink"
          >
            What comes next
          </h2>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-ink-muted">
          Once your handle is set, you will build out the rest, step by step.
        </p>
        <ol role="list" className="mt-4 grid gap-3 sm:grid-cols-3">
          <NextStep
            n={2}
            icon={IdCard}
            title="Build your profile"
            body="Add your identity, avatar, links, and favorites."
          />
          <NextStep
            n={3}
            icon={LayoutPanelTop}
            title="Arrange your page"
            body="Feature your ranking boards and leagues."
          />
          <NextStep
            n={4}
            icon={Globe}
            title="Publish and share"
            body="Go live and start growing your audience."
          />
        </ol>
      </section>
    </div>
  );
}

/** Branded round emblem for the claim intro (mirrors the hero card's mark). */
function ClaimEmblem() {
  return (
    <span
      aria-hidden="true"
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-beacon text-black shadow-md shadow-brand-purple/30"
    >
      <Radio className="h-6 w-6" />
    </span>
  );
}

function ClaimPoint({
  icon: Icon,
  title,
  body,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
}) {
  return (
    <li className="flex items-start gap-3 rounded-card border border-line bg-base/60 p-4">
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card border border-line bg-surface text-brand-cyan"
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">
          {body}
        </span>
      </span>
    </li>
  );
}

function NextStep({
  n,
  icon: Icon,
  title,
  body,
}: {
  n: number;
  icon: LucideIcon;
  title: string;
  body: string;
}) {
  return (
    <li className="rounded-card border border-line bg-surface/60 p-4">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-card border border-line bg-base text-brand-cyan"
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
          Step {n}
        </span>
      </div>
      <h3 className="mt-2 text-sm font-semibold text-ink">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{body}</p>
    </li>
  );
}

/* ---------- State 2: wizard (claimed, never published) ---------- */

function WizardView({ steps }: { steps: StepCompletion }) {
  const doneCount = SIGNAL_SUBPAGES.filter((p) => steps[p.key]).length;
  const total = SIGNAL_SUBPAGES.length;
  // The first incomplete step (in order) is the suggested next action. Handle is
  // always complete here, so this lands on the first real piece of setup.
  const nextKey = SIGNAL_SUBPAGES.find((p) => !steps[p.key])?.key ?? null;

  return (
    <div className="space-y-8">
      <SignalEditorSubNav />

      <header>
        <SectionEyebrow>Setup</SectionEyebrow>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          Build your Signal, step by step.
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-muted">
          Work through the steps below in any order. Each one is optional except
          your handle, which you already have. When you are happy with it, the
          last step publishes your profile to the web.
        </p>
        <p className="mt-3 text-sm font-medium text-ink">
          <span className="text-brand-cyan">{doneCount}</span> of {total} steps
          started.
        </p>
      </header>

      <ol role="list" className="space-y-3">
        {SIGNAL_SUBPAGES.map((page, i) => (
          <WizardStep
            key={page.key}
            page={page}
            index={i + 1}
            done={steps[page.key]}
            isNext={page.key === nextKey}
          />
        ))}
      </ol>
    </div>
  );
}

function WizardStep({
  page,
  index,
  done,
  isNext,
}: {
  page: SignalSubpage;
  index: number;
  done: boolean;
  isNext: boolean;
}) {
  return (
    <li
      className={`rounded-card border bg-surface/60 p-5 transition-colors ${
        isNext ? "border-brand-purple/60 bg-brand-purple/[0.06]" : "border-line"
      }`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden="true"
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${
              done
                ? "border-signal-success/40 bg-signal-success/10 text-signal-success"
                : "border-line bg-base text-ink-muted"
            }`}
          >
            {done ? <Check className="h-4 w-4" /> : index}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-ink">
                {page.wizardTitle}
              </h3>
              {done ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-signal-success/40 bg-signal-success/10 px-2 py-0.5 text-[11px] font-semibold text-signal-success">
                  <Check aria-hidden="true" className="h-3 w-3" />
                  Started
                </span>
              ) : isNext ? (
                <span className="rounded-full border border-brand-purple/50 bg-brand-purple/10 px-2 py-0.5 text-[11px] font-semibold text-brand-purple">
                  Start here
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm leading-relaxed text-ink-muted">
              {page.wizardBody}
            </p>
          </div>
        </div>

        <Link
          href={page.href}
          aria-label={
            done
              ? `Edit ${page.label}. Already started. ${page.summary}`
              : isNext
                ? `Start here. ${page.cta}. ${page.summary}`
                : `${page.cta}. ${page.summary}`
          }
          className={`inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-card px-4 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
            isNext
              ? "bg-beacon text-black transition-opacity hover:opacity-90"
              : "border border-line bg-base text-ink transition-colors hover:border-line-accent"
          }`}
        >
          {done ? "Edit" : page.cta}
          <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
        </Link>
      </div>
    </li>
  );
}

/* ---------- State 3: card hub (launched) ---------- */

function HubGrid({
  signal,
  steps,
}: {
  signal: OwnerSignal;
  steps: StepCompletion;
}) {
  return (
    <div className="space-y-8">
      <SignalEditorSubNav />

      <header>
        <div className="flex items-center gap-2">
          <Sparkles aria-hidden="true" className="h-4 w-4 text-brand-purple" />
          <SectionEyebrow>Your Signal</SectionEyebrow>
        </div>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          Manage your profile.
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-muted">
          Your Signal is live. Jump into any section to update it. Changes save
          as you go and appear on your public profile right away.
        </p>
      </header>

      <ul role="list" className="grid gap-3 sm:grid-cols-2">
        {SIGNAL_SUBPAGES.map((page) => (
          <HubCard
            key={page.key}
            page={page}
            done={steps[page.key]}
            signal={signal}
          />
        ))}
      </ul>
    </div>
  );
}

function HubCard({
  page,
  done,
  signal,
}: {
  page: SignalSubpage;
  done: boolean;
  signal: OwnerSignal;
}) {
  const Icon = page.icon;
  const status = hubCardStatus(page, done, signal);

  return (
    <li>
      <Link
        href={page.href}
        aria-label={`${page.label}. ${page.summary} Status: ${status.srLabel}.`}
        className="group flex h-full items-start gap-4 rounded-card border border-line bg-surface/60 p-5 transition-colors hover:border-brand-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card border border-line bg-base text-brand-cyan"
        >
          <Icon className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ink">{page.label}</span>
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${status.tone}`}
            >
              {status.withCheck && (
                <Check aria-hidden="true" className="h-3 w-3" />
              )}
              {!status.withCheck && !status.solid && (
                <CircleDashed aria-hidden="true" className="h-3 w-3" />
              )}
              {status.label}
            </span>
          </span>
          <span className="mt-1 block text-sm leading-relaxed text-ink-muted">
            {page.summary}
          </span>
        </span>
        <ArrowRight
          aria-hidden="true"
          className="mt-1 h-4 w-4 shrink-0 text-ink-subtle transition-colors group-hover:text-brand-cyan"
        />
      </Link>
    </li>
  );
}

/** Per-card status pill. The visibility card mirrors the live/private/draft
 * state; every other card shows a simple set-up indicator. */
function hubCardStatus(
  page: SignalSubpage,
  done: boolean,
  signal: OwnerSignal,
): {
  label: string;
  srLabel: string;
  tone: string;
  withCheck: boolean;
  solid: boolean;
} {
  if (page.key === "visibility") {
    const isLive =
      signal.status === "published" && signal.visibility === "public";
    if (isLive) {
      return {
        label: "Live",
        srLabel: "live and public",
        tone: "border-signal-success/40 bg-signal-success/10 text-signal-success",
        withCheck: true,
        solid: true,
      };
    }
    if (signal.status === "published") {
      return {
        label: "Private",
        srLabel: "published but private",
        tone: "border-brand-cyan/40 bg-brand-cyan/10 text-brand-cyan",
        withCheck: false,
        solid: true,
      };
    }
    return {
      label: "Draft",
      srLabel: "in draft",
      tone: "border-line bg-base text-ink-muted",
      withCheck: false,
      solid: true,
    };
  }

  if (page.key === "handle") {
    return {
      label: "Claimed",
      srLabel: "claimed",
      tone: "border-signal-success/40 bg-signal-success/10 text-signal-success",
      withCheck: true,
      solid: true,
    };
  }

  return done
    ? {
        label: "Set up",
        srLabel: "set up",
        tone: "border-signal-success/40 bg-signal-success/10 text-signal-success",
        withCheck: true,
        solid: true,
      }
    : {
        label: "Optional",
        srLabel: "not set up yet",
        tone: "border-line bg-base text-ink-muted",
        withCheck: false,
        solid: false,
      };
}

/* ---------- Shared ---------- */

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
      {children}
    </p>
  );
}
