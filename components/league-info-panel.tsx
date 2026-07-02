/**
 * LeagueInfoPanel: the league's identity + context, rendered as a highlighted
 * card so it stands out immediately (purple border, soft glow, and a beacon
 * radial wash, matching the On The Clock cockpit's standout box). Carries the
 * page's h1 (the league name) at a large size, an at-a-glance meta line (status,
 * season, team count, derived format), and the roster + scoring settings.
 *
 * Two layouts:
 *   - "sidebar" (Overview): everything stacked in a narrow rail.
 *   - "horizontal" (Teams): a full-width band split 1/3 · 1/3 · 1/3 into
 *     identity, roster, and scoring, so the rosters below can use full width.
 *
 * Presentational server component. Every colored element is paired with text,
 * so nothing here is color-only. Timestamps arrive pre-formatted from the page.
 */

import {
  CalendarDays,
  Users,
  Trophy,
  LayoutGrid,
  Calculator,
  type LucideIcon,
} from "lucide-react";
import { humanizeLeagueStatus } from "@/lib/league-status";
import type { FormatTag } from "@/lib/league-format-tags";

export function LeagueInfoPanel({
  layout = "sidebar",
  showFooter = true,
  leagueName,
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
}: {
  layout?: "sidebar" | "horizontal";
  /** When false, the last-updated / values meta is NOT rendered inside the card
   *  (the Teams page renders it separately as a discreet line). Defaults true. */
  showFooter?: boolean;
  leagueName: string;
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
}) {
  const horizontal = layout === "horizontal";

  // Roster makeup: Start N + per-position slots. The SF (superflex) flag is
  // intentionally dropped here because it's already conveyed by the "SF" slot
  // count and the derived format label above, so it's not repeated.
  const startTag = formatTags.filter((t) => t.key === "ss");
  const positionTags = formatTags.filter((t) => t.key.startsWith("pos-"));
  const rosterTags = [...startTag, ...positionTags];

  const identity = (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
        This league
      </p>
      <h1
        id="league-info-title"
        className="mt-1 text-2xl font-bold leading-tight tracking-tight text-ink sm:text-3xl"
      >
        {leagueName}
      </h1>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StatusPill status={status} />
        {season != null && <MetaChip icon={CalendarDays}>{season} season</MetaChip>}
        {teamCount != null && (
          <MetaChip icon={Users}>
            {teamCount} {teamCount === 1 ? "team" : "teams"}
          </MetaChip>
        )}
      </div>
      <p className="mt-2.5 flex items-start gap-1.5 text-sm leading-snug">
        <Trophy aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-brand-cyan" />
        <span className="font-medium text-ink">{derivedLabel}</span>
      </p>
    </div>
  );

  const rosterBlock = (
    <Section icon={LayoutGrid} title="Roster">
      {rosterTags.length > 0 ? (
        <TagList tags={rosterTags} />
      ) : (
        <p className="text-xs italic text-ink-subtle">Roster shape unavailable.</p>
      )}
    </Section>
  );

  const scoringBlock = (
    <Section icon={Calculator} title="Scoring">
      {scoringTags.length > 0 ? (
        <TagList tags={scoringTags} />
      ) : (
        <p className="text-xs italic text-ink-subtle">Standard scoring.</p>
      )}
    </Section>
  );

  const footer = showFooter ? (
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
  ) : null;

  return (
    <section
      aria-labelledby="league-info-title"
      className="relative overflow-hidden rounded-modal border border-brand-purple/30 bg-surface/40"
      style={{
        boxShadow: "0 0 80px -40px rgba(168, 85, 247, 0.55)",
        backgroundImage:
          "radial-gradient(ellipse at 0% 0%, rgba(168, 85, 247, 0.12) 0%, transparent 55%), radial-gradient(ellipse at 100% 100%, rgba(34, 211, 238, 0.10) 0%, transparent 55%)",
      }}
    >
      {/* Top-edge beacon hairline, decorative. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
        }}
      />
      <div className="p-5 sm:p-6">
        {horizontal ? (
          <>
            {/* 1/3 · 1/3 · 1/3 band: identity, roster, scoring. */}
            <div className="grid gap-5 md:grid-cols-3 md:gap-6">
              {identity}
              <div className="md:border-l md:border-line/60 md:pl-6">{rosterBlock}</div>
              <div className="md:border-l md:border-line/60 md:pl-6">{scoringBlock}</div>
            </div>
            {footer}
          </>
        ) : (
          <>
            {identity}
            <div className="mt-4">{rosterBlock}</div>
            <div className="mt-4">{scoringBlock}</div>
            {footer}
          </>
        )}
      </div>
    </section>
  );
}

/**
 * Compact, single-line league meta (last updated + value source/coverage) for
 * the Teams page, where it lives discreetly under the horizontal info band
 * instead of taking a full block inside the card. Same information, minimal
 * vertical space.
 */
export function LeagueMetaLine({
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
  const parts: React.ReactNode[] = [
    <span key="updated">
      Updated {lastUpdatedLabel}
      {cached ? ", cached" : ""}
    </span>,
  ];
  if (coverage !== "none") {
    parts.push(
      <span key="values">
        Values via <span className="text-ink-muted">{sourceDisplay}</span>{" "}
        <span className="text-ink-subtle">•</span>{" "}
        <span className="text-ink-muted">{formatDisplay}</span>
      </span>,
    );
  }
  if (coverage === "fallback" && fallbackDisplay) {
    parts.push(
      <span key="fallback" className="text-brand-cyan">
        closest match to {fallbackDisplay}
      </span>,
    );
  }
  if (coverage === "none") {
    parts.push(
      <span key="none" className="text-signal-warning">
        no values for {derivedLabel}
      </span>,
    );
  }
  if (coverage !== "none" && pickSourceDisplay) {
    parts.push(<span key="picks">picks via {pickSourceDisplay}</span>);
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-subtle">
      {parts.map((node, i) => (
        <span key={i} className="flex items-center gap-2">
          {i > 0 && (
            <span aria-hidden="true" className="text-line-accent">
              ·
            </span>
          )}
          {node}
        </span>
      ))}
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-subtle">
        <Icon aria-hidden="true" className="h-3.5 w-3.5 text-brand-cyan" />
        {title}
      </p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function TagList({ tags }: { tags: FormatTag[] }) {
  // Two visual tones so format meta (cyan) is scannable apart from per-slot
  // counts (purple), mirroring the FF Beacon brand split. Border + chip tint
  // are inline so the colors survive PurgeCSS even when Tailwind misses the
  // arbitrary value.
  const styles = {
    format: {
      backgroundColor: "rgba(34, 211, 238, 0.08)",
      borderColor: "rgba(34, 211, 238, 0.30)",
      color: "#22D3EE",
    },
    position: {
      backgroundColor: "rgba(168, 85, 247, 0.08)",
      borderColor: "rgba(168, 85, 247, 0.30)",
      color: "#A855F7",
    },
  } as const;
  return (
    <ul className="flex flex-wrap gap-1.5" role="list">
      {tags.map((t) => (
        <li
          key={t.key}
          className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide"
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
    <div className="mt-4 space-y-2 border-t border-line/70 pt-3 text-xs leading-relaxed text-ink-muted">
      <p>
        Last updated {lastUpdatedLabel}
        {cached ? " (served from cache)" : " (fresh from Sleeper)"}.
      </p>
      {coverage !== "none" && (
        <p>
          Values via <span className="text-ink">{sourceDisplay}</span>{" "}
          <span className="text-ink-subtle">•</span>{" "}
          <span className="text-ink">{formatDisplay}</span>
        </p>
      )}

      {coverage === "fallback" && fallbackDisplay && (
        <p
          role="status"
          className="rounded-card border border-brand-cyan/30 bg-brand-cyan/5 p-2.5 text-ink-muted"
        >
          Showing values for {formatDisplay} because {sourceDisplay} doesn't
          publish data for {fallbackDisplay}. Pick a different source from the
          header to find a closer match.
        </p>
      )}

      {coverage === "none" && (
        <p
          role="status"
          className="rounded-card border border-signal-warning/40 bg-signal-warning/10 p-2.5 text-signal-warning"
        >
          No data source covers {derivedLabel} yet. Players still show with
          names; values are unavailable for this combination.
        </p>
      )}

      {coverage !== "none" && pickSourceDisplay && (
        <p role="note" className="text-ink-subtle">
          Draft pick values powered by {pickSourceDisplay} ({sourceDisplay}{" "}
          doesn't publish pick values).
        </p>
      )}
    </div>
  );
}

function MetaChip({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line bg-base/50 px-2 py-0.5 text-xs text-ink-muted">
      <Icon aria-hidden="true" className="h-3 w-3 text-brand-cyan" />
      {children}
    </span>
  );
}

function StatusPill({ status }: { status: string | null }) {
  const label = humanizeLeagueStatus(status);
  const key = (status ?? "").toLowerCase();
  // Map Sleeper status → semantic accent. Pre-draft = brand cyan (build-up
  // energy), drafting = warning amber (active event), in-season = brand
  // purple (live), complete = green, anything else = neutral subtle.
  const palette: { dot: string; chip: string; text: string } =
    key === "pre_draft"
      ? { dot: "#22D3EE", chip: "rgba(34, 211, 238, 0.10)", text: "#22D3EE" }
      : key === "drafting"
        ? { dot: "#F59E0B", chip: "rgba(245, 158, 11, 0.10)", text: "#F59E0B" }
        : key === "in_season"
          ? { dot: "#A855F7", chip: "rgba(168, 85, 247, 0.10)", text: "#A855F7" }
          : key === "complete"
            ? { dot: "#10B981", chip: "rgba(16, 185, 129, 0.10)", text: "#10B981" }
            : { dot: "#6B6B7D", chip: "rgba(107, 107, 125, 0.10)", text: "#A8A8B8" };
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold"
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
