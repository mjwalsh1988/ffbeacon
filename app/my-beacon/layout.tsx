import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MyBeaconNav } from "@/components/my-beacon-nav";

export const metadata: Metadata = {
  title: {
    template: "%s | My Beacon",
    default: "My Beacon",
  },
  description: "My Beacon is your personal fantasy cockpit: leagues, rankings, custom boards, and every FF Beacon tool in one accessible place.",
};

// Force-dynamic across the entire /my-beacon space because every page
// reads the authenticated user's session on the server.
export const dynamic = "force-dynamic";

export default async function MyBeaconLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/my-beacon");
  }

  // Prefer the email's local part for the greeting because most users sign
  // in with email-based providers; OAuth users still get a usable handle.
  const displayName = user.email ? user.email.split("@")[0] : "fantasy player";

  return (
    <main id="main">
      <MyBeaconHero displayName={displayName} />
      <MyBeaconNav />
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
        {children}
      </div>
    </main>
  );
}

function MyBeaconHero({ displayName }: { displayName: string }) {
  return (
    <header className="relative overflow-hidden border-b border-line">
      {/* Beacon-gradient accent bar pinned to the very top — matches the
          home/about/author hero treatment so the dashboard reads as part
          of the same brand surface. */}
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
      <div className="relative mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
          My Beacon
        </p>
        {/* aria-label keeps the announced heading clean even though the
            gradient is achieved via a nested span. */}
        <h1
          aria-label={`Welcome back, ${displayName}.`}
          className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl"
        >
          Welcome back,{" "}
          <span
            className="bg-clip-text text-transparent"
            style={{
              backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
            }}
          >
            {displayName}
          </span>
          .
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-muted sm:text-lg">
          My Beacon is your fantasy cockpit: one place to run your leagues,
          rankings, custom boards, and every tool in the system, with more
          landing here as we build it. Same clarity, by eye or by ear.
        </p>
      </div>
    </header>
  );
}
