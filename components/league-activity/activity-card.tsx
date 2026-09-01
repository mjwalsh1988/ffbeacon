import Link from "next/link";
import { ArrowRight, Info, Minus, Plus } from "lucide-react";
import { SleeperAvatar } from "@/components/sleeper-avatar";
import type {
  ActivityAsset,
  ActivityCard as ActivityCardData,
  ActivityChange,
  ActivityChip,
  ActivityColumn,
  ActivityStat,
} from "@/lib/league-activity/types";
import {
  ACTIVITY_ACCENTS,
  ACTIVITY_ICONS,
  positionTagClass,
} from "./activity-visuals";

/**
 * One entry in the activity log.
 *
 * A SERVER COMPONENT with no state and no client JavaScript. Everything a card
 * shows was settled before it got here, so there is nothing to hydrate, and a
 * feed of forty of these adds nothing to the bundle.
 *
 * THE LAYOUT IS THE SAME AT EVERY WIDTH, and that is a rule rather than a
 * shortcut. Two-sided cards (a trade, a final score) sit side by side above
 * `sm` and stack below it; nothing is dropped and no responsive utility hides a
 * field that has no home in the narrow layout. See CLAUDE.md, Mobile-First
 * Layout Rule.
 *
 * NOTHING THAT CARRIES DATA IS TRUNCATED, either. Player names, team names,
 * handles, asset details and stat labels all WRAP. An earlier draft clipped
 * them with `truncate`, which on a trade card made the only place a player is
 * named unreadable at 320px, and made "Touchdowns Syndrome bench" on a result
 * card into a label with no full form anywhere on the page.
 *
 * THE CARD IS NAMED BY ITS OWN HEADING. `aria-labelledby` rather than an
 * `aria-label` summary, so a screen reader hears the entry once. See the note
 * at the bottom of lib/league-activity/types.ts.
 *
 * COLOUR CARRIES NOTHING ON ITS OWN. The accent rail, the tinted icon tile and
 * the win/loss colouring all repeat in text: the eyebrow names the kind, the
 * column headings say "Winner" and "Loser", and every icon is aria-hidden.
 */
export function ActivityCard({
  card,
  headingLevel = 3,
}: {
  card: ActivityCardData;
  /**
   * Threaded from the panel so the outline never skips a level: an h2 panel
   * gives h3 cards, an h3 panel gives h4.
   */
  headingLevel?: 3 | 4;
}) {
  const accent = ACTIVITY_ACCENTS[card.accent];
  const Icon = ACTIVITY_ICONS[card.icon];
  const Heading = (`h${headingLevel}` as const) as "h3" | "h4";
  const titleId = `${card.id}-title`;

  return (
    <article
      aria-labelledby={titleId}
      className="group relative overflow-hidden rounded-card border border-line bg-surface/80 shadow-lg shadow-black/20 transition-colors hover:border-line-accent focus-within:border-line-accent"
    >
      {/* The category rail. Decorative: the eyebrow says the same thing in
          words, and pointer-events-none keeps a mouse-tracking screen reader
          from announcing an unnamed element sitting over the card's edge. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 w-[3px]"
        style={{ backgroundImage: accent.rail }}
      />
      {/* A soft wash under the header so the icon tile does not float on flat
          colour. Sized to the header band, not the whole card. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-24"
        style={{
          backgroundImage: `radial-gradient(120% 100% at 0% 0%, ${accent.glow} 0%, transparent 70%)`,
        }}
      />

      <div className="relative pl-4 pr-3.5 py-3.5 sm:pl-5 sm:pr-4 sm:py-4">
        <header className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] ${accent.tile}`}
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p
                className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${accent.text}`}
              >
                {card.eyebrow}
              </p>
              {card.weekLabel && (
                <span className="rounded-full border border-line-accent bg-base/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                  {card.weekLabel}
                </span>
              )}
            </div>
            <Heading
              id={titleId}
              className="mt-1 text-[15px] font-semibold leading-snug text-ink"
            >
              {card.title}
            </Heading>
            {card.line && (
              <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{card.line}</p>
            )}
          </div>

          {/* The relative time is the glanceable half; the exact one is in the
              meta row below and is never hidden at any width. */}
          {card.timeRelative && (
            <time
              dateTime={card.occurredAtIso}
              className="shrink-0 pt-0.5 text-[11px] font-medium tabular-nums text-ink-subtle"
            >
              {card.timeRelative}
            </time>
          )}
        </header>

        {card.chips.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {card.chips.map((chip) => (
              <TeamChip key={chip.rosterId} chip={chip} />
            ))}
          </div>
        )}

        {card.columns.length > 0 && <Columns columns={card.columns} />}

        {card.moves.length > 0 && <Moves assets={card.moves} />}

        {card.changes.length > 0 && <Changes changes={card.changes} />}

        {card.stats.length > 0 && <Stats stats={card.stats} />}

        {card.footnote && (
          <p className="mt-3 flex items-start gap-2 rounded-[10px] border border-line bg-base/50 px-3 py-2 text-[12px] leading-relaxed text-ink-muted">
            <Info aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-subtle" />
            <span>{card.footnote}</span>
          </p>
        )}

        <footer className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-line pt-2.5">
          <p className="text-[11px] leading-relaxed text-ink-subtle">
            {card.timeLabel}
            {card.timeNote && (
              // The window an observed change was spotted in. Rendered rather
              // than tucked into a tooltip: it is the difference between a fact
              // and a guess, and a reader is entitled to it without hovering.
              <span className="block text-ink-subtle">{card.timeNote}</span>
            )}
          </p>
          {card.href && (
            <Link
              href={card.href}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded text-[12px] font-semibold text-brand-cyan transition-colors hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan sm:min-h-0 sm:py-2"
            >
              {card.hrefLabel ?? "Open"}
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
            </Link>
          )}
        </footer>
      </div>
    </article>
  );
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                     */
/* -------------------------------------------------------------------------- */

function TeamChip({ chip }: { chip: ActivityChip }) {
  const tone =
    chip.tone === "win"
      ? "border-signal-success/40 bg-signal-success/10"
      : chip.tone === "loss"
        ? "border-signal-danger/30 bg-signal-danger/5"
        : chip.tone === "tie"
          ? "border-signal-warning/40 bg-signal-warning/10"
          : "border-line-accent bg-base/50";

  const body = (
    <>
      {/* Decorative: the team name is printed on the next line, so an alt
          repeating it makes a reader hear the name twice per chip. */}
      <SleeperAvatar avatarId={chip.avatarId} title="" size={20} />
      <span className="min-w-0">
        <span className="block text-[12px] font-semibold text-ink">{chip.label}</span>
        {chip.owner && (
          <span className="block text-[10px] text-ink-subtle">{chip.owner}</span>
        )}
      </span>
    </>
  );

  if (!chip.href) {
    return (
      <span className={`inline-flex items-center gap-2 rounded-full border px-2 py-1 ${tone}`}>
        {body}
      </span>
    );
  }

  return (
    <Link
      href={chip.href}
      // Named explicitly. The chip's text already gives the link its name, but
      // saying where it goes turns "Alice FC @alice, link" into something a
      // reader can act on without entering it.
      aria-label={`${chip.label}, open this team`}
      className={`inline-flex min-h-[44px] items-center gap-2 rounded-full border px-2 py-1 sm:min-h-[32px] transition-colors hover:border-brand-cyan/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${tone}`}
    >
      {body}
    </Link>
  );
}

/**
 * The two-sided body: a trade's halves, or a final score.
 *
 * Grid rather than flex so the two columns are exactly equal at every width,
 * which is what stops a one-player side reading as the smaller half of a trade
 * when it is a straight swap.
 */
function Columns({ columns }: { columns: ActivityColumn[] }) {
  return (
    <div
      className={`mt-3 grid gap-2.5 ${columns.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3"}`}
    >
      {columns.map((col, i) => {
        const tone =
          col.tone === "win"
            ? "border-signal-success/35 bg-signal-success/[0.06]"
            : col.tone === "loss"
              ? "border-line bg-base/40"
              : col.tone === "tie"
                ? "border-signal-warning/35 bg-signal-warning/[0.06]"
                : "border-line bg-base/40";
        return (
          <div key={`${col.heading}-${i}`} className={`rounded-[10px] border p-3 ${tone}`}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
              {col.heading}
            </p>

            {col.chip && (
              <div className="mt-1.5 flex items-center gap-2">
                <SleeperAvatar avatarId={col.chip.avatarId} title="" size={22} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-ink">
                    {col.chip.label}
                  </span>
                  {col.chip.owner && (
                    <span className="block text-[10px] text-ink-subtle">
                      {col.chip.owner}
                    </span>
                  )}
                </span>
                {col.score && (
                  <span
                    className={`shrink-0 font-mono text-lg font-bold tabular-nums ${
                      col.tone === "win"
                        ? "text-signal-success"
                        : col.tone === "tie"
                          ? "text-signal-warning"
                          : "text-ink-muted"
                    }`}
                  >
                    {col.score}
                  </span>
                )}
              </div>
            )}

            {col.assets.length > 0 && (
              <ul className="mt-2.5 space-y-1.5">
                {col.assets.map((asset) => (
                  <li key={asset.key}>
                    <AssetRow asset={asset} showDirection={false} />
                  </li>
                ))}
              </ul>
            )}

            {col.faab && (
              <p className="mt-2 inline-flex items-center rounded-full border border-brand-cyan/30 bg-brand-cyan/10 px-2 py-0.5 text-[11px] font-semibold text-brand-cyan">
                {col.faab}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A flat in-and-out list: a waiver claim, a lineup swap, a slot change. */
function Moves({ assets }: { assets: ActivityAsset[] }) {
  return (
    <ul className="mt-3 space-y-1.5 rounded-[10px] border border-line bg-base/40 p-2.5">
      {assets.map((asset) => (
        <li key={asset.key}>
          <AssetRow asset={asset} showDirection />
        </li>
      ))}
    </ul>
  );
}

function AssetRow({
  asset,
  showDirection,
}: {
  asset: ActivityAsset;
  showDirection: boolean;
}) {
  const isIn = asset.direction === "in";
  return (
    <div className="flex items-center gap-2">
      {showDirection && (
        <span
          className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${
            isIn
              ? "bg-signal-success/15 text-signal-success"
              : "bg-signal-danger/15 text-signal-danger"
          }`}
        >
          {/* The glyph repeats what the visually hidden word says, so the row is
              never colour-only. */}
          {isIn ? (
            <Plus aria-hidden="true" className="h-3 w-3" />
          ) : (
            <Minus aria-hidden="true" className="h-3 w-3" />
          )}
          <span className="sr-only">{isIn ? "In: " : "Out: "}</span>
        </span>
      )}
      {asset.position && (
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ring-1 ring-inset ${positionTagClass(asset.position)}`}
        >
          {asset.position}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-ink">{asset.label}</span>
        {asset.detail && (
          <span className="block text-[10px] text-ink-subtle">{asset.detail}</span>
        )}
      </span>
    </div>
  );
}

/**
 * Before and after.
 *
 * A definition list, because that is what this is: a labelled term with two
 * values. The old value is struck through AND prefixed with a visually hidden
 * "was", so the change survives a screen reader that does not announce
 * line-through styling.
 */
function Changes({ changes }: { changes: ActivityChange[] }) {
  return (
    <dl className="mt-3 divide-y divide-line overflow-hidden rounded-[10px] border border-line bg-base/40">
      {changes.map((change, i) => (
        <div
          key={`${change.label}-${i}`}
          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2"
        >
          <dt className="text-[12px] font-medium text-ink-muted">{change.label}</dt>
          <dd className="flex items-center gap-2 font-mono text-[12px] tabular-nums">
            <span className="text-ink-subtle line-through decoration-ink-subtle/60">
              <span className="sr-only">was </span>
              {change.from}
            </span>
            <ArrowRight aria-hidden="true" className="h-3 w-3 text-ink-subtle" />
            <span
              className={
                change.direction === "up"
                  ? "font-semibold text-signal-success"
                  : change.direction === "down"
                    ? "font-semibold text-signal-warning"
                    : "font-semibold text-ink"
              }
            >
              <span className="sr-only">now </span>
              {change.to}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Stats({ stats }: { stats: ActivityStat[] }) {
  return (
    // Flex rather than grid: a card with ONE stat ("winning bid, $2") looked
    // absurd stretched across a third of a full-width page. These size to their
    // contents from a sensible floor and wrap when there are several.
    <dl className="mt-3 flex flex-wrap gap-2">
      {stats.map((stat, i) => (
        <div
          key={`${stat.label}-${i}`}
          className="min-w-[9rem] flex-1 basis-auto rounded-[10px] border border-line bg-base/50 px-3 py-2 sm:flex-none"
        >
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
            {stat.label}
          </dt>
          <dd
            className={`mt-0.5 font-mono text-[15px] font-bold tabular-nums ${
              stat.tone === "good"
                ? "text-signal-success"
                : stat.tone === "bad"
                  ? "text-signal-warning"
                  : "text-ink"
            }`}
          >
            {stat.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
