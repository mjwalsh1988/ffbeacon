import type { Metadata } from "next";
import Link from "next/link";
import {
  Trophy,
  BarChart3,
  Calculator,
  Workflow,
  Sparkles,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getActiveFormats, getAvailableSources } from "@/lib/source";
import { resolveFormatSlug, resolveSourceSlug } from "@/lib/preferences";
import { parseSleeperLeagueSettings } from "@/lib/sleeper-league-settings";
import { shortFormatName } from "@/lib/format-display";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your FF Beacon dashboard — a snapshot of your activity, preferences, and quick links to every tool.",
};

type StatCard = {
  label: string;
  value: string;
  caption: string;
  /** Numeric values use the mono gradient treatment; text values use sans
   * at a smaller size so longer strings like "Dynasty Superflex" fit. */
  kind: "numeric" | "text";
  /** Optional accessible name for the value — used when the visible value
   * is abbreviated (e.g. "Dynasty PPR SF") and we want screen readers to
   * hear the full unabbreviated form ("Dynasty PPR Superflex"). */
  valueAriaLabel?: string;
};

type QuickAction = {
  href: string;
  title: string;
  body: string;
  icon: LucideIcon;
};

const QUICK_ACTIONS: QuickAction[] = [
  {
    href: "/my-beacon/sleeper-leagues",
    title: "My Sleeper Leagues",
    body: "Save your Sleeper username, sync every league, and open any one for a deep view.",
    icon: Trophy,
  },
  {
    href: "/rankings",
    title: "Rankings Board",
    body: "Sortable rankings across every active format. Switch sources without losing your place.",
    icon: BarChart3,
  },
  {
    href: "/tools/faab",
    title: "FAAB Calculator",
    body: "Market value plus your real need, weighted into a recommended bid range.",
    icon: Calculator,
  },
  {
    href: "/tools/league-sync",
    title: "League Sync",
    body: "Pull every league for a Sleeper username — no account required for the preview view.",
    icon: Workflow,
  },
];

type ComingSoon = {
  title: string;
  body: string;
};

const COMING_SOON: ComingSoon[] = [
  {
    title: "Custom scoring profiles",
    body: "Save your league's exact scoring and use it everywhere — rankings, trade values, FAAB.",
  },
  {
    title: "Weekly digest",
    body: "An accessible, plain-English summary of what changed across your leagues, every Tuesday.",
  },
  {
    title: "Trade radar",
    body: "Alerts when a player you roster swings significantly in value, scoped to your formats.",
  },
];

export default async function MyBeaconDashboardPage() {
  const supabase = await createClient();

  // Parallel fetch: user (for member-since year) + both registries +
  // resolved preference slugs. The registry fetches are React.cache'd so
  // the layout's hero call shares the same Promise.
  const [
    {
      data: { user },
    },
    formats,
    sources,
    formatRes,
    sourceRes,
  ] = await Promise.all([
    supabase.auth.getUser(),
    getActiveFormats(supabase),
    getAvailableSources(supabase),
    // No URL params on this page — resolvers fall through DB → cookie →
    // default. For a logged-in user that almost always means DB.
    resolveFormatSlug(supabase, undefined),
    resolveSourceSlug(supabase, undefined),
  ]);

  // Fetch sleeper_league_settings separately because it needs the user.id
  // we just resolved above (so it can't go in the parallel batch).
  const { data: prefs } = await supabase
    .from("user_preferences")
    .select("sleeper_league_settings")
    .eq("user_id", user!.id)
    .maybeSingle();
  const settings = parseSleeperLeagueSettings(prefs?.sleeper_league_settings);

  // Profile-league count = union of "featured" and "shown" league ids.
  // A featured league counts even if it isn't separately toggled to show,
  // because pinning it to the profile is itself a kind of visibility.
  const profileLeagueIds = new Set<string>(settings.shown_league_ids ?? []);
  if (settings.featured_league_id) {
    profileLeagueIds.add(settings.featured_league_id);
  }
  const profileLeagueCount = profileLeagueIds.size;

  const formatRow = formats.find((f) => f.slug === formatRes.slug);
  const sourceRow = sources.find((s) => s.slug === sourceRes.slug);

  // Keep the full display name available for accessibility — the card
  // value uses the abbreviated form for visual density, but screen
  // readers should still hear "Superflex" via the aria-label below.
  const formatFullName = formatRow?.display_name ?? "—";
  const formatDisplay = shortFormatName(formatFullName);
  const sourceDisplay = sourceRow?.display_name ?? "—";

  // user.created_at is an ISO string in the Supabase auth schema.
  // Format as short month + year (e.g. "Dec 2026") for a friendlier
  // display than a full date and to avoid the privacy-questionable
  // "member for N days" pattern.
  const memberSince = user?.created_at
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        year: "numeric",
      }).format(new Date(user.created_at))
    : "—";

  const statCards: StatCard[] = [
    {
      label: "On profile",
      value: profileLeagueCount.toString(),
      caption:
        profileLeagueCount === 0
          ? "Toggle Featured or Show on My Sleeper Leagues."
          : "Leagues featured or shown on your public profile.",
      kind: "numeric",
    },
    {
      label: "Default format",
      value: formatDisplay,
      // SR hears the full "Dynasty PPR Superflex" instead of "Dynasty PPR SF".
      valueAriaLabel: formatFullName,
      caption: "Change from the header.",
      kind: "text",
    },
    {
      label: "Default source",
      value: sourceDisplay,
      caption: "Switchable per page.",
      kind: "text",
    },
    {
      label: "Member since",
      value: memberSince,
      caption: "Welcome aboard.",
      // Text variant — the date string mixes letters and digits, which
      // reads awkwardly in mono and risks overflow on narrow mobile cards.
      kind: "text",
    },
  ];

  return (
    <div className="space-y-12">
      <StatsSection cards={statCards} />
      <QuickActionsSection />
      <ComingSoonSection />
      <SignOutSection />
    </div>
  );
}

/* ---------- Stats ---------- */

function StatsSection({ cards }: { cards: StatCard[] }) {
  return (
    <section aria-labelledby="stats-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <SectionEyebrow>Snapshot</SectionEyebrow>
          <h2
            id="stats-heading"
            className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl"
          >
            Your account at a glance.
          </h2>
        </div>
        <p className="text-sm text-ink-muted">
          Format and source reflect your current saved preferences.
        </p>
      </div>

      <ul
        role="list"
        className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4"
      >
        {cards.map((stat) => (
          <li
            key={stat.label}
            className="rounded-card border border-line bg-surface/60 p-4"
          >
            <p
              className={`bg-clip-text font-bold text-transparent ${
                stat.kind === "numeric"
                  ? "font-mono text-2xl tabular-nums sm:text-3xl"
                  : "text-lg sm:text-xl"
              }`}
              style={{
                backgroundImage:
                  "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
              }}
              aria-label={stat.valueAriaLabel}
            >
              {stat.value}
            </p>
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
              {stat.label}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-ink-muted">
              {stat.caption}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------- Quick actions ---------- */

function QuickActionsSection() {
  return (
    <section aria-labelledby="actions-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <SectionEyebrow>Quick actions</SectionEyebrow>
          <h2
            id="actions-heading"
            className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl"
          >
            Jump straight to the tools you use most.
          </h2>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {QUICK_ACTIONS.map((action) => (
          <QuickActionCard key={action.href} {...action} />
        ))}
      </div>
    </section>
  );
}

function QuickActionCard({ href, title, body, icon: Icon }: QuickAction) {
  return (
    <article className="group relative flex flex-col rounded-card border border-line bg-surface p-6 transition-colors hover:border-brand-purple/60">
      <span
        aria-hidden="true"
        className="flex h-11 w-11 items-center justify-center rounded-card border border-line bg-base text-brand-cyan"
      >
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="mt-4 text-lg font-semibold text-ink">{title}</h3>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-muted">
        {body}
      </p>
      <Link
        href={href}
        className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-cyan hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
        aria-label={`Open ${title}`}
      >
        Open
        <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
      </Link>
    </article>
  );
}

/* ---------- Coming soon ---------- */

function ComingSoonSection() {
  return (
    <section
      aria-labelledby="coming-heading"
      className="rounded-modal border border-line bg-surface/40 p-6 sm:p-8"
      style={{
        backgroundImage:
          "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.10) 0%, transparent 55%), radial-gradient(ellipse at 100% 100%, rgba(34, 211, 238, 0.10) 0%, transparent 55%)",
      }}
    >
      <div className="flex items-center gap-2">
        <Sparkles aria-hidden="true" className="h-4 w-4 text-brand-purple" />
        <SectionEyebrow>On the roadmap</SectionEyebrow>
      </div>
      <h2
        id="coming-heading"
        className="mt-2 max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl"
      >
        What&rsquo;s landing in My Beacon next.
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-muted">
        These are the next surfaces planned for your personal dashboard. None
        are live yet — but they&rsquo;ll show up here without breaking the
        layout when they ship.
      </p>

      <ul
        role="list"
        className="mt-8 grid gap-3 sm:grid-cols-3"
      >
        {COMING_SOON.map((item) => (
          <li
            key={item.title}
            className="rounded-card border border-dashed border-line bg-base/40 p-5"
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
              Coming soon
            </p>
            <h3 className="mt-2 text-base font-semibold text-ink">{item.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              {item.body}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------- Sign out ---------- */

function SignOutSection() {
  return (
    <section aria-labelledby="signout-heading" className="border-t border-line pt-10">
      <h2 id="signout-heading" className="sr-only">
        Sign out
      </h2>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-line bg-surface p-5">
        <p className="text-sm text-ink-muted">
          Done for the day? End your session.
        </p>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="inline-flex h-10 items-center rounded-card border border-line bg-base px-4 text-sm font-medium text-ink hover:border-line-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
          >
            Sign out
          </button>
        </form>
      </div>
    </section>
  );
}

/* ---------- Shared ---------- */

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
      {children}
    </p>
  );
}
