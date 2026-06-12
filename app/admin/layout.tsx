import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin-auth";
import { AdminNav } from "@/components/admin-nav";

export const metadata: Metadata = {
  title: {
    template: "%s | Admin",
    default: "Admin",
  },
  description: "FF Beacon admin panel.",
  robots: { index: false, follow: false },
};

// The entire /admin space reads the authenticated session on the server and
// must never be statically cached.
export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Primary gate: redirects to /login when signed out, /my-beacon when signed
  // in but not an admin. Each page re-checks independently (defense in depth).
  await requireAdmin();

  return (
    <main id="main">
      <AdminHero />
      <AdminNav />
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
        {children}
      </div>
    </main>
  );
}

function AdminHero() {
  return (
    <header className="relative overflow-hidden border-b border-line">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 35%, #22D3EE 65%, transparent 100%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/2 h-[360px] w-[820px] -translate-x-1/2"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(168, 85, 247, 0.16) 0%, rgba(34, 211, 238, 0.08) 45%, transparent 75%)",
        }}
      />
      <div className="relative mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-14 lg:px-8">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
          Admin
        </p>
        <h1 className="max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          System control panel
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-muted">
          Health, activity, and operational logs for FF Beacon. Visible only to
          admins.
        </p>
      </div>
    </header>
  );
}
