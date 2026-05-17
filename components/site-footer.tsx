import Link from "next/link";
import { FOOTER_COLUMNS, SOCIAL_LINKS, SITE } from "@/lib/site";

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-24 border-t border-line bg-surface/50">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          {FOOTER_COLUMNS.map((column) => (
            <nav key={column.heading} aria-labelledby={`footer-${column.heading.toLowerCase()}`}>
              <h2
                id={`footer-${column.heading.toLowerCase()}`}
                className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-subtle"
              >
                {column.heading}
              </h2>
              <ul className="space-y-2 text-sm">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-ink-muted hover:text-ink"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-12 flex flex-col gap-4 border-t border-line pt-6 text-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between">
          <p>
            Built and maintained by{" "}
            <Link href={SITE.author.bylineHref} className="font-medium text-ink hover:text-brand-purple">
              {SITE.author.name}
            </Link>{" "}
            at {SITE.name}. © {year}
          </p>
          <ul className="flex gap-4">
            {SOCIAL_LINKS.map((link) => (
              <li key={link.href}>
                {link.external ? (
                  <a
                    href={link.href}
                    rel="noopener noreferrer"
                    target="_blank"
                    className="hover:text-ink"
                  >
                    {link.label}
                    <span className="sr-only"> (opens in new tab)</span>
                  </a>
                ) : (
                  <a href={link.href} className="hover:text-ink">
                    {link.label}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
