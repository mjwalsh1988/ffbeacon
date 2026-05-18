import Link from "next/link";
import { FOOTER_COLUMNS, SOCIAL_LINKS, SITE } from "@/lib/site";
import { BeaconMark } from "@/components/beacon-mark";

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-24 border-t border-line bg-surface/50">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        {/* Top grid: About column (wider) on the left, the three navigational
            columns on the right. Mobile stacks them linearly. */}
        <div className="grid grid-cols-1 gap-10 md:grid-cols-[1.6fr_1fr_1fr_1fr]">
          <AboutColumn />
          {FOOTER_COLUMNS.map((column) => (
            <nav
              key={column.heading}
              aria-labelledby={`footer-${column.heading.toLowerCase()}`}
            >
              <h2
                id={`footer-${column.heading.toLowerCase()}`}
                className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-subtle"
              >
                {column.heading}
              </h2>
              <ul className="space-y-2 text-sm">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-ink-muted hover:text-ink">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 border-t border-line pt-6 text-sm text-ink-muted">
          <p>
            Built and maintained by{" "}
            <Link
              href={SITE.author.bylineHref}
              className="font-medium text-ink hover:text-brand-purple"
            >
              {SITE.author.name}
            </Link>{" "}
            at {SITE.name}. © {year}
          </p>
        </div>
      </div>
    </footer>
  );
}

function AboutColumn() {
  return (
    <div className="max-w-sm">
      <Link
        href="/"
        className="inline-flex items-center text-base focus-visible:outline-2 focus-visible:outline-brand-cyan"
        aria-label={`${SITE.name} home`}
      >
        <BeaconMark logoSize={32} />
      </Link>
      <p className="mt-4 text-sm leading-relaxed text-ink-muted">{SITE.about}</p>
      <ul className="mt-5 flex items-center gap-2" aria-label="Social profiles">
        {SOCIAL_LINKS.map((link) => (
          <li key={link.label}>
            <a
              href={link.href}
              {...(link.external
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
              aria-label={`${SITE.name} on ${link.label}${link.external ? " (opens in new tab)" : ""}`}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface text-ink-muted transition-colors hover:border-brand-purple/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              <SocialIcon name={link.label} className="h-4 w-4" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SocialIcon({
  name,
  className,
}: {
  name: "Facebook" | "Instagram" | "X" | "TikTok";
  className?: string;
}) {
  const shared = {
    className,
    viewBox: "0 0 24 24",
    "aria-hidden": true as const,
    focusable: false,
  };
  switch (name) {
    case "Facebook":
      return (
        <svg {...shared} fill="currentColor">
          <path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.77-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.77l-.44 2.89h-2.33v6.99A10 10 0 0 0 22 12z" />
        </svg>
      );
    case "Instagram":
      return (
        <svg
          {...shared}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <path d="M16 11.37a4 4 0 1 1-7.91 1.16 4 4 0 0 1 7.91-1.16Z" />
          <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
        </svg>
      );
    case "X":
      return (
        <svg {...shared} fill="currentColor">
          <path d="M18.244 2H21.5l-7.5 8.572L23 22h-6.86l-5.36-6.97L4.7 22H1.44l8.02-9.16L1 2h6.99l4.84 6.42L18.244 2Zm-1.2 18h1.86L7.05 4H5.07l11.974 16Z" />
        </svg>
      );
    case "TikTok":
      return (
        <svg {...shared} fill="currentColor">
          <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.84a8.16 8.16 0 0 0 4.77 1.52V6.92a4.85 4.85 0 0 1-1.84-.23Z" />
        </svg>
      );
    default:
      return null;
  }
}
