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
                  <li key={`${column.heading}-${link.label}`}>
                    {link.disabled ? (
                      <span
                        className="cursor-default text-ink-subtle/70"
                        aria-disabled="true"
                        title="Coming soon"
                      >
                        {link.label}
                      </span>
                    ) : (
                      <Link href={link.href} className="text-ink-muted hover:text-ink">
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 border-t border-line pt-6 text-sm text-ink-muted">
          <p>
            © {year} {SITE.name}
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
            {link.disabled ? (
              <span
                aria-disabled="true"
                aria-label={`${SITE.name} on ${link.label} (coming soon)`}
                title="Coming soon"
                className="inline-flex h-9 w-9 cursor-default items-center justify-center rounded-full border border-line bg-surface text-ink-subtle/70"
              >
                <SocialIcon name={link.label} className="h-4 w-4" />
              </span>
            ) : (
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
            )}
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
  name: "Instagram" | "X" | "TikTok" | "YouTube" | "Discord";
  className?: string;
}) {
  const shared = {
    className,
    viewBox: "0 0 24 24",
    "aria-hidden": true as const,
    focusable: false,
  };
  switch (name) {
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
    case "YouTube":
      return (
        <svg {...shared} fill="currentColor">
          <path d="M23.5 6.2a3.02 3.02 0 0 0-2.12-2.14C19.5 3.55 12 3.55 12 3.55s-7.5 0-9.38.51A3.02 3.02 0 0 0 .5 6.2 31.6 31.6 0 0 0 0 12a31.6 31.6 0 0 0 .5 5.8 3.02 3.02 0 0 0 2.12 2.14c1.88.51 9.38.51 9.38.51s7.5 0 9.38-.51a3.02 3.02 0 0 0 2.12-2.14A31.6 31.6 0 0 0 24 12a31.6 31.6 0 0 0-.5-5.8ZM9.6 15.57V8.43L15.82 12 9.6 15.57Z" />
        </svg>
      );
    case "Discord":
      return (
        <svg {...shared} fill="currentColor">
          <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.07.07 0 0 0-.075.035c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.075-.035 19.74 19.74 0 0 0-4.885 1.515.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.2 14.2 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
        </svg>
      );
    default:
      return null;
  }
}
