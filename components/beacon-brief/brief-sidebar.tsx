import Link from "next/link";
import { Newspaper, Tag, Users, Shield, LayoutGrid } from "lucide-react";
import type { BriefSidebarData } from "@/lib/beacon-brief-feed";

export type BriefActiveFilter =
  | { type: "all" }
  | { type: "category"; value: string }
  | { type: "tag"; value: string }
  | { type: "player"; value: string }
  | { type: "team"; value: string };

function isActive(
  active: BriefActiveFilter,
  type: BriefActiveFilter["type"],
  value?: string,
): boolean {
  if (active.type !== type) return false;
  if (active.type === "all") return true;
  return "value" in active && active.value === value;
}

const linkBase =
  "flex items-center justify-between gap-2 rounded-card px-3 py-2 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan min-h-11 sm:min-h-0";
const linkIdle = "text-ink-muted hover:bg-surface hover:text-ink";
const linkActive =
  "bg-brand-purple/15 text-ink border-l-2 border-l-brand-purple font-medium";

function SectionHeading({
  icon: Icon,
  children,
  id,
}: {
  icon: typeof Tag;
  children: React.ReactNode;
  id: string;
}) {
  return (
    <h2
      id={id}
      className="mb-2 flex items-center gap-2 px-3 text-xs font-semibold uppercase tracking-[0.14em] text-ink-subtle"
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5 text-brand-cyan" />
      {children}
    </h2>
  );
}

function CountPill({ count }: { count: number }) {
  return (
    <span className="shrink-0 rounded-full bg-base px-2 py-0.5 text-[11px] tabular-nums text-ink-subtle">
      {count}
    </span>
  );
}

/**
 * The Beacon Brief filter rail: browse all, or narrow by category, tag, player,
 * or team. Pure presentational and used verbatim in both the desktop rail and
 * the mobile full-screen drawer.
 */
export function BriefSidebar({
  data,
  active,
}: {
  data: BriefSidebarData;
  active: BriefActiveFilter;
}) {
  const { categories, tags, players, teams } = data;

  return (
    <nav aria-label="Filter The Beacon Brief" className="space-y-7">
      <div>
        <Link
          href="/brief"
          aria-current={active.type === "all" ? "page" : undefined}
          className={`${linkBase} ${active.type === "all" ? linkActive : linkIdle}`}
        >
          <span className="flex items-center gap-2">
            <LayoutGrid aria-hidden="true" className="h-4 w-4" />
            All articles
          </span>
        </Link>
      </div>

      {categories.length > 0 && (
        <div>
          <SectionHeading icon={Newspaper} id="brief-cats">
            Categories
          </SectionHeading>
          <ul aria-labelledby="brief-cats" className="space-y-0.5">
            {categories.map((c) => (
              <li key={c.slug}>
                <Link
                  href={`/brief/category/${c.slug}`}
                  aria-current={isActive(active, "category", c.slug) ? "page" : undefined}
                  className={`${linkBase} ${isActive(active, "category", c.slug) ? linkActive : linkIdle}`}
                >
                  <span className="truncate">{c.name}</span>
                  <CountPill count={c.count} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {players.length > 0 && (
        <div>
          <SectionHeading icon={Users} id="brief-players">
            Players in the news
          </SectionHeading>
          <ul aria-labelledby="brief-players" className="space-y-0.5">
            {players.map((p) => (
              <li key={p.slug}>
                <Link
                  href={`/brief/player/${p.slug}`}
                  aria-current={isActive(active, "player", p.slug) ? "page" : undefined}
                  className={`${linkBase} ${isActive(active, "player", p.slug) ? linkActive : linkIdle}`}
                >
                  <span className="truncate">{p.name}</span>
                  {(p.position || p.team) && (
                    <span className="shrink-0 text-[11px] text-ink-subtle">
                      {[p.position, p.team].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {teams.length > 0 && (
        <div>
          <SectionHeading icon={Shield} id="brief-teams">
            Teams in the news
          </SectionHeading>
          <ul aria-labelledby="brief-teams" className="space-y-0.5">
            {teams.map((t) => (
              <li key={t.abbreviation}>
                <Link
                  href={`/brief/team/${t.abbreviation}`}
                  aria-current={isActive(active, "team", t.abbreviation) ? "page" : undefined}
                  className={`${linkBase} ${isActive(active, "team", t.abbreviation) ? linkActive : linkIdle}`}
                >
                  <span className="truncate">{t.name}</span>
                  <span className="shrink-0 text-[11px] font-medium text-ink-subtle">
                    {t.abbreviation}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tags.length > 0 && (
        <div>
          <SectionHeading icon={Tag} id="brief-tags">
            Popular tags
          </SectionHeading>
          <ul aria-labelledby="brief-tags" className="flex flex-wrap gap-2 px-3">
            {tags.map((t) => (
              <li key={t.tag}>
                <Link
                  href={`/brief/tag/${encodeURIComponent(t.tag)}`}
                  aria-current={isActive(active, "tag", t.tag) ? "page" : undefined}
                  className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan ${
                    isActive(active, "tag", t.tag)
                      ? "border-brand-purple bg-brand-purple/15 text-ink"
                      : "border-line bg-base text-ink-muted hover:border-line-accent hover:text-ink"
                  }`}
                >
                  {t.tag}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </nav>
  );
}
