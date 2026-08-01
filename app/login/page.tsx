import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Sign in or create an FF Beacon account to vote, save your Sleeper username, and follow players.",
};

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string; next?: string }>;
}) {
  return (
    <main id="main" className="relative overflow-hidden">
      {/* Beacon-gradient accent bar pinned to the very top of the page. */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 35%, #22D3EE 65%, transparent 100%)",
        }}
      />
      {/* Soft ambient glow behind the form card, same shape as the hero
          versions on other pages, just centered behind the smaller layout
          so the page reads as "ambient FF Beacon" without the full hero. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/2 h-[420px] w-[820px] -translate-x-1/2"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(168, 85, 247, 0.18) 0%, rgba(34, 211, 238, 0.10) 45%, transparent 75%)",
        }}
      />

      {/* Outer container matches the site header (max-w-7xl) for edge
          alignment consistency across the site. The focused form card
          stays centered at its intended narrower width. */}
      <div className="relative mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        <div className="mx-auto max-w-xl">
          <header className="mb-6 text-center">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-cyan">
              Account
            </p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Sign in or register
            </h1>
          </header>
          <LoginForm searchParamsPromise={searchParams} />
        </div>
      </div>
    </main>
  );
}
