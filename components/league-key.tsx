import {
  TeamStatusBadge,
  TeamStatusPending,
} from "@/components/team-status-badge";
import {
  teamStatusWords,
  type TeamStatusKey,
  type TeamStatusVariant,
} from "@/lib/league-team-status";

/**
 * What the pills in the "Your team" column mean.
 *
 * ONE component, two shapes, because there is one key. The dashboard puts it in
 * a right sidebar where it stays beside the list; the public tool runs it full
 * width under the table. Both read the same entries below, so the two surfaces
 * cannot end up explaining the same tag differently, which is the failure this
 * whole file exists to prevent.
 *
 * WHY EACH ENTRY IS A BOX
 *   It used to be a badge with a sentence floating beside it. At a glance that
 *   reads as a run of text with some colour in it rather than as a lookup table,
 *   and in a narrow sidebar the sentence had about 150px to live in. Each entry
 *   is now its own bordered card with the tag on top and one line under it, so
 *   the eye can jump straight to the tag it is trying to look up.
 *
 * WHY THE COPY IS SHORT
 *   A key is read while the reader is part way through a different task. The
 *   long form explained the underlying measure inside every entry, which meant
 *   saying "expected wins" three times. It is said once, in the footnote.
 */

type LeagueKeyLayout =
  /** Right sidebar on /my-beacon/sleeper-leagues. One column throughout. */
  | "panel"
  /** Full width under the public tool's table. Spreads onto a grid. */
  | "inline";

/**
 * Four cards for three bands. The third band is one call with two names: a
 * dynasty or keeper roster low on wins is holding assets for later, and a
 * redraft roster in the same place has nothing to hold them for. Both appear
 * here because this list sits above leagues of both kinds.
 */
const TAG_ENTRIES: {
  key: TeamStatusKey;
  variant: TeamStatusVariant;
  blurb: string;
}[] = [
  {
    key: "competitor",
    variant: "dynasty",
    blurb: "Near the top of the league on expected wins.",
  },
  {
    key: "middle",
    variant: "dynasty",
    blurb: "Mid-table on expected wins and on roster value.",
  },
  {
    key: "rebuilder",
    variant: "dynasty",
    blurb: "Dynasty or keeper. Low on expected wins, high on trade value.",
  },
  {
    key: "rebuilder",
    variant: "redraft",
    blurb: "Redraft. Low on expected wins, with no next year to bank on.",
  },
];

const FIGURE_ENTRIES: { term: string; def: string }[] = [
  {
    term: "Contender, Bubble",
    def: "Projected finish. Gold, silver, or bronze on the top three.",
  },
  {
    term: "Rebuilder, Longshot",
    def: "Roster value and where it ranks, because neither one is measured in wins.",
  },
];

export function LeagueKey({
  layout = "inline",
  headingId = "league-key-heading",
  className = "",
}: {
  layout?: LeagueKeyLayout;
  /** So the sidebar's <aside> can point aria-labelledby at the heading. */
  headingId?: string;
  className?: string;
}) {
  const panel = layout === "panel";
  // The tag cards are one column in the sidebar and spread out inline. Three
  // across is what stops the key being taller than it is useful now that the
  // third band carries both of its names.
  const tagGrid = panel ? "grid-cols-1" : "sm:grid-cols-2 lg:grid-cols-3";
  const figureGrid = panel ? "grid-cols-1" : "sm:grid-cols-2";

  return (
    <div
      className={`overflow-hidden rounded-card border border-line bg-surface/40 ${className}`}
    >
      <div className="border-b border-line bg-surface/60 px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
          Key
        </p>
        <h3 id={headingId} className="mt-0.5 text-sm font-semibold text-ink">
          Reading a row
        </h3>
      </div>

      <div className="divide-y divide-line">
        <Section title="Team tag">
          <dl className={`grid gap-2 ${tagGrid}`}>
            {TAG_ENTRIES.map((entry) => (
              <KeyCard
                key={`${entry.variant}-${entry.key}`}
                badge={
                  <TeamStatusBadge
                    size="sm"
                    status={{
                      key: entry.key,
                      variant: entry.variant,
                      ...teamStatusWords(entry.key, entry.variant),
                      // The definition is in the dd beside it. Passing the reason
                      // as well would have a screen reader read the explanation
                      // twice in a row.
                      reason: "",
                    }}
                  />
                }
                blurb={entry.blurb}
              />
            ))}
            <KeyCard
              badge={<TeamStatusPending size="sm" />}
              blurb="Never loaded. Press Sync on the row to calculate it."
            />
          </dl>
        </Section>

        <Section title="The figure beside it">
          <dl className={`grid gap-2 ${figureGrid}`}>
            {FIGURE_ENTRIES.map((entry) => (
              <div
                key={entry.term}
                className="rounded-card border border-line bg-base/40 px-3 py-2"
              >
                <dt className="text-[11px] font-semibold text-ink">
                  {entry.term}
                </dt>
                <dd className="mt-0.5 text-xs leading-relaxed text-ink-muted">
                  {entry.def}
                </dd>
              </div>
            ))}
          </dl>
        </Section>
      </div>

      <p className="border-t border-line px-4 py-3 text-[11px] leading-relaxed text-ink-subtle">
        Expected wins come from Power Pulse, which projects the rest of the
        season. One league syncs at a time.
      </p>
    </div>
  );
}

/* ---------- pieces ---------- */

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="px-4 py-3">
      <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-subtle">
        {title}
      </h4>
      {children}
    </section>
  );
}

/**
 * One tag and its definition, boxed. The badge sits on its own line rather than
 * beside the text: at sidebar width a badge and a sentence side by side leaves
 * the sentence about eight characters a line.
 */
function KeyCard({ badge, blurb }: { badge: React.ReactNode; blurb: string }) {
  return (
    <div className="rounded-card border border-line bg-base/40 px-3 py-2">
      <dt>{badge}</dt>
      <dd className="mt-1.5 text-xs leading-relaxed text-ink-muted">{blurb}</dd>
    </div>
  );
}
