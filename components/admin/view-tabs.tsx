import Link from "next/link";

/**
 * Server-rendered, no-JS tab strip. Each tab is a link that swaps a `view`
 * search param while preserving the rest of the query string, so toggling a tab
 * is a normal navigation that survives the GET-form filters on the page (the
 * active tab is encoded in the URL, not client state). aria-current marks the
 * active tab for assistive tech. Styling mirrors the top admin nav tabs.
 */

export type ViewTab = { key: string; label: string; href: string };

export function ViewTabs({
  tabs,
  current,
  label,
}: {
  tabs: ViewTab[];
  current: string;
  label: string;
}) {
  return (
    <nav aria-label={label} className="border-b border-line">
      <ul role="list" className="-mb-px flex flex-wrap gap-1">
        {tabs.map((t) => {
          const active = t.key === current;
          return (
            <li key={t.key}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-[44px] items-center border-b-[3px] px-4 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-brand-cyan ${
                  active
                    ? "border-brand-purple text-ink"
                    : "border-transparent text-ink-muted hover:text-ink"
                }`}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
