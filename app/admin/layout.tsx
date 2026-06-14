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

  // The hero (and its H1) is rendered by the /admin index page, not here, so
  // every admin sub-page owns its own unique H1 for screen-reader navigation.
  return (
    <main id="main">
      <AdminNav />
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
        {children}
      </div>
    </main>
  );
}
