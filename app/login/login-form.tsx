"use client";

import { use, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";

type Status =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "sent"; email: string };

export function LoginForm({
  searchParamsPromise,
}: {
  searchParamsPromise: Promise<{ error?: string; sent?: string }>;
}) {
  const initial = use(searchParamsPromise);
  const [status, setStatus] = useState<Status>(
    initial.error
      ? { kind: "error", message: initial.error }
      : initial.sent
        ? { kind: "sent", email: initial.sent }
        : { kind: "idle" },
  );
  const [email, setEmail] = useState("");
  const [pending, startTransition] = useTransition();

  const supabase = createClient();
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (typeof window !== "undefined" ? window.location.origin : "");

  const signInWith = (provider: "google" | "discord") => {
    startTransition(async () => {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${siteUrl}/auth/callback` },
      });
      if (error) setStatus({ kind: "error", message: error.message });
    });
  };

  const sendMagicLink = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email) return;
    startTransition(async () => {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${siteUrl}/auth/callback` },
      });
      if (error) {
        setStatus({ kind: "error", message: error.message });
      } else {
        setStatus({ kind: "sent", email });
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3" role="group" aria-labelledby="oauth-heading">
        <h2 id="oauth-heading" className="sr-only">
          Sign in with a provider
        </h2>
        <button
          type="button"
          onClick={() => signInWith("google")}
          disabled={pending}
          className="flex w-full items-center justify-center gap-3 rounded-card border border-line bg-surface px-4 py-3 text-sm font-medium hover:border-line-accent disabled:opacity-50"
        >
          Continue with Google
        </button>
        <button
          type="button"
          onClick={() => signInWith("discord")}
          disabled={pending}
          className="flex w-full items-center justify-center gap-3 rounded-card border border-line bg-surface px-4 py-3 text-sm font-medium hover:border-line-accent disabled:opacity-50"
        >
          Continue with Discord
        </button>
      </div>

      <div role="separator" aria-orientation="horizontal" className="flex items-center gap-3 text-xs text-ink-subtle">
        <span className="h-px flex-1 bg-line" aria-hidden="true" />
        <span>or email a magic link</span>
        <span className="h-px flex-1 bg-line" aria-hidden="true" />
      </div>

      <form onSubmit={sendMagicLink} className="space-y-3" aria-describedby="magic-link-help">
        <label htmlFor="email" className="block text-sm font-medium">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-card border border-line bg-surface px-4 py-3 text-sm focus:border-brand-purple focus:outline-none"
        />
        <p id="magic-link-help" className="text-xs text-ink-subtle">
          We will email you a one-time sign-in link. No password required.
        </p>
        <button
          type="submit"
          disabled={pending || !email}
          className="w-full rounded-card bg-beacon px-4 py-3 text-sm font-semibold text-black disabled:opacity-50"
        >
          {pending ? "Sending..." : "Email me a link"}
        </button>
      </form>

      <div aria-live="polite" className="min-h-[1.5rem] text-sm">
        {status.kind === "error" && (
          <p className="text-signal-danger" role="alert">
            {status.message}
          </p>
        )}
        {status.kind === "sent" && (
          <p className="text-signal-success">
            Check {status.email} for a sign-in link.
          </p>
        )}
      </div>
    </div>
  );
}
