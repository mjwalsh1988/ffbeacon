/**
 * One link in a list of places to go: an icon, a name, and a line saying what
 * you get. Used by About and the author page, where most of what a reader wants
 * next is somewhere else on the site.
 *
 * The whole tile is the link, so the target is a 44px-plus rectangle rather than
 * a few words of text, and the icon is decorative because the name carries the
 * accessible name.
 *
 * Presentational server component.
 */

import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, type LucideIcon } from "lucide-react";

export function LinkTile({
  href,
  icon: Icon,
  title,
  body,
  accent = "cyan",
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  body: string;
  accent?: "cyan" | "purple";
}) {
  const color = accent === "purple" ? "#A855F7" : "#22D3EE";
  return (
    <Link
      href={href as Route}
      className="group flex min-h-11 items-start gap-3 rounded-card border border-l-2 border-line bg-base/50 p-3 transition-colors hover:border-line-accent hover:bg-ink/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
    >
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-card border"
        style={{
          backgroundImage: `linear-gradient(135deg, ${color}26 0%, ${color}0D 100%)`,
          borderColor: `${color}59`,
          color,
        }}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">{body}</span>
      </span>
      <ArrowRight
        aria-hidden="true"
        className="mt-1 h-4 w-4 shrink-0 text-ink-subtle transition-transform motion-safe:group-hover:translate-x-0.5"
      />
    </Link>
  );
}
