import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to FF Beacon to vote, save your Sleeper username, and follow players.",
};

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  return (
    <main id="main" className="mx-auto max-w-md px-6 py-16">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-ink-muted">
          Sign in with Google, Discord, or a magic link emailed to you. We never post anywhere on your behalf.
        </p>
      </header>
      <LoginForm searchParamsPromise={searchParams} />
    </main>
  );
}
