/**
 * LeagueMasthead: the one header card that sits above every League Pulse
 * section, so the league you are looking at is named the same way whether you
 * are on Overview, Teams, Schedules, Power Pulse, Trade Ideas, or Transactions.
 *
 * It carries the page's h1 (the league name, set large and uppercase against a
 * beacon gradient), the at-a-glance chips beside it, the roster and scoring
 * makeup, and the provenance line saying when the data last synced and which
 * source and format the values came from.
 *
 * It used to carry a strip of four stat tiles as well: Teams, Season, Starters,
 * and Status. Every one of them said what something else in this same card
 * already said, the chips row for the first two and the last, the Roster tags
 * for Starters, so the strip was a second copy of the header inside the header.
 * It is gone rather than hidden, and nothing was lost with it.
 *
 * Presentational server component. Every colored element is paired with text,
 * so nothing here is color-only.
 */

import { CalendarDays, Users, Trophy, LayoutGrid, Calculator } from "lucide-react";
import { LeagueLogo } from "@/components/league-logo";
import { humanizeLeagueStatus } from "@/lib/league-status";
import type { FormatTag } from "@/lib/league-format-tags";

export type LeagueMastheadProps = {
  leagueName: string;
  /** Sleeper's avatar id for this league, from `leagues.metadata->>avatar`.
   *  Decorative: the league name is right beside it. Null renders the same
   *  sized placeholder, so the header never reflows between leagues. */
  avatarId?: string | null;
  season: string | number | null;
  teamCount: number | null;
  status: string | null;
  /** Roster tags from buildLeagueFormatTags (Start N + per-position slots). */
  formatTags: FormatTag[];
  /** Scoring tags from buildLeagueScoringTags. */
  scoringTags: FormatTag[];
  lastUpdatedLabel: string;
  cached: boolean;
  coverage: "exact" | "fallback" | "none";
  sourceDisplay: string;
  formatDisplay: string;
  /** describeDerived(context.derived): the league's structural format in words. */
  derivedLabel: string;
  /** context.fallback?.derivedDisplay, when coverage is "fallback". */
  fallbackDisplay: string | null;
  /** pickSource.display when it differs from the value source, else null. */
  pickSourceDisplay: string | null;
};

export function LeagueMasthead({
  leagueName,
  avatarId = null,
  season,
  teamCount,
  status,
  formatTags,
  scoringTags,
  lastUpdatedLabel,
  cached,
  coverage,
  sourceDisplay,
  formatDisplay,
  derivedLabel,
  fallbackDisplay,
  pickSourceDisplay,
}: LeagueMastheadProps) {
  // Roster makeup: Start N + per-position slots. The SF flag is left out here
  // because the SF slot count and the derived format label already say it.
  const startTag = formatTags.find((t) => t.key === "ss") ?? null;
  const positionTags = formatTags.filter((t) => t.key.startsWith("pos-"));
  const rosterTags = startTag ? [startTag, ...positionTags] : positionTags;

  return (
    <section
      aria-labelledby="league-masthead-title"
      className="relative overflow-hidden rounded-modal border border-line-accent bg-surface/40"
      style={{
        backgroundImage:
          "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.14) 0%, transparent 58%), radial-gradient(ellipse at 100% 0%, rgba(34, 211, 238, 0.10) 0%, transparent 60%)",
      }}
    >
      {/* Top-edge beacon hairline, decorative. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
        }}
      />

      <div className="p-5 sm:p-6 lg:p-7">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-brand-cyan">
            League Pulse
          </p>
          {/* The same logo the reader just clicked on a list, at the top of
              what opened. Decorative: the name is the next element. */}
          <div className="mt-2 flex items-center gap-3 sm:gap-4">
            <LeagueLogo avatarId={avatarId} name={leagueName} size={64} />
            <h1
              id="league-masthead-title"
              className="lp-league-name min-w-0 text-[clamp(1.9rem,5.2vw,3.5rem)]"
            >
              {leagueName}
            </h1>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusPill status={status} />
            {season != null && (
              <MetaChip icon={CalendarDays}>{season} season</MetaChip>
            )}
            {teamCount != null && (
              <MetaChip icon={Users}>
                {teamCount} {teamCount === 1 ? "team" : "teams"}
              </MetaChip>
            )}
          </div>
          <p className="mt-3 flex items-start gap-1.5 text-sm leading-snug sm:text-base">
            <Trophy
              aria-hidden="true"
              className="mt-0.5 h-4 w-4 shrink-0 text-brand-cyan"
            />
            <span className="font-medium text-ink">{derivedLabel}</span>
          </p>
        </div>

        <div className="mt-5 grid gap-5 border-t border-line/70 pt-5 md:grid-cols-2 md:gap-6">
          <Section icon={LayoutGrid} title="Roster">
            {rosterTags.length > 0 ? (
              <TagList tags={rosterTags} />
            ) : (
              <p className="text-xs italic text-ink-subtle">Roster shape unavailable.</p>
            )}
          </Section>
          <Section icon={Calculator} title="Scoring">
            {scoringTags.length > 0 ? (
              <TagList tags={scoringTags} />
            ) : (
              <p className="text-xs italic text-ink-subtle">Standard scoring.</p>
            )}
          </Section>
        </div>

        <MetaFooter
          lastUpdatedLabel={lastUpdatedLabel}
          cached={cached}
          coverage={coverage}
          sourceDisplay={sourceDisplay}
          formatDisplay={formatDisplay}
          derivedLabel={derivedLabel}
          fallbackDisplay={fallbackDisplay}
          pickSourceDisplay={pickSourceDisplay}
        />
      </div>
    </section>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-ink-subtle">
        <Icon aria-hidden="true" className="h-3.5 w-3.5 text-brand-cyan" />
        {title}
      </p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function TagList({ tags }: { tags: FormatTag[] }) {
  // Two tones so format meta (cyan) stays scannable apart from per-slot counts
  // (purple). Colors are inline so they survive PurgeCSS.
  const styles = {
    format: {
      backgroundColor: "rgba(34, 211, 238, 0.08)",
      borderColor: "rgba(34, 211, 238, 0.30)",
      color: "#22D3EE",
    },
    position: {
      backgroundColor: "rgba(168, 85, 247, 0.08)",
      borderColor: "rgba(168, 85, 247, 0.30)",
      color: "#C084FC",
    },
  } as const;
  return (
    <ul className="flex flex-wrap gap-1.5" role="list">
      {tags.map((t) => (
        <li
          key={t.key}
          className="inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-semibold tracking-wide"
          style={styles[t.tone]}
        >
          {t.label}
        </li>
      ))}
    </ul>
  );
}

function MetaFooter({
  lastUpdatedLabel,
  cached,
  coverage,
  sourceDisplay,
  formatDisplay,
  derivedLabel,
  fallbackDisplay,
  pickSourceDisplay,
}: {
  lastUpdatedLabel: string;
  cached: boolean;
  coverage: "exact" | "fallback" | "none";
  sourceDisplay: string;
  formatDisplay: string;
  derivedLabel: string;
  fallbackDisplay: string | null;
  pickSourceDisplay: string | null;
}) {
  return (
    <div className="mt-5 border-t border-line/70 pt-3">
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-subtle">
        <span>
          Last updated {lastUpdatedLabel}
          {cached ? " (served from cache)" : " (fresh from Sleeper)"}
          {coverage !== "none" ? "," : ""}
        </span>
        {coverage !== "none" && (
          <span>
            values via <span className="text-ink-muted">{sourceDisplay}</span>,{" "}
            <span className="text-ink-muted">{formatDisplay}</span>
            {pickSourceDisplay ? "," : ""}
          </span>
        )}
        {coverage !== "none" && pickSourceDisplay && (
          <span>picks via {pickSourceDisplay}</span>
        )}
      </p>

      {coverage === "fallback" && fallbackDisplay && (
        <p
          role="status"
          className="mt-2.5 rounded-card border border-brand-cyan/30 bg-brand-cyan/5 p-2.5 text-xs leading-relaxed text-ink-muted"
        >
          Showing values for {formatDisplay} because {sourceDisplay} doesn't publish
          data for {fallbackDisplay}. Pick a different source from the site header to
          find a closer match.
        </p>
      )}

      {coverage === "none" && (
        <p
          role="status"
          className="mt-2.5 rounded-card border border-signal-warning/40 bg-signal-warning/10 p-2.5 text-xs leading-relaxed text-signal-warning"
        >
          No data source covers {derivedLabel} yet. Players still show with names;
          values are unavailable for this combination.
        </p>
      )}
    </div>
  );
}

function MetaChip({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line bg-base/60 px-2.5 py-1 text-xs text-ink-muted">
      <Icon aria-hidden="true" className="h-3 w-3 text-brand-cyan" />
      {children}
    </span>
  );
}

function StatusPill({ status }: { status: string | null }) {
  const label = humanizeLeagueStatus(status);
  const key = (status ?? "").toLowerCase();
  // Sleeper status mapped to a semantic accent: pre-draft cyan (build-up),
  // drafting amber (live event), in-season purple (running), complete green.
  const palette: { dot: string; chip: string; text: string } =
    key === "pre_draft"
      ? { dot: "#22D3EE", chip: "rgba(34, 211, 238, 0.10)", text: "#22D3EE" }
      : key === "drafting"
        ? { dot: "#F59E0B", chip: "rgba(245, 158, 11, 0.10)", text: "#F59E0B" }
        : key === "in_season"
          ? { dot: "#A855F7", chip: "rgba(168, 85, 247, 0.12)", text: "#C084FC" }
          : key === "complete"
            ? { dot: "#10B981", chip: "rgba(16, 185, 129, 0.10)", text: "#10B981" }
            : { dot: "#6B6B7D", chip: "rgba(107, 107, 125, 0.10)", text: "#A8A8B8" };
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold"
      style={{
        backgroundColor: palette.chip,
        borderColor: `${palette.dot}55`,
        color: palette.text,
      }}
      aria-label={`Status: ${label}`}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: palette.dot, boxShadow: `0 0 6px ${palette.dot}` }}
      />
      {label}
    </span>
  );
}
