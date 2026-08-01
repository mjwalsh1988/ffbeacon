"use client";

import { use, useId, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";

type Mode = "signin" | "signup";

type Status =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "sent_magic"; email: string }
  | { kind: "sent_confirm"; email: string }
  | { kind: "signed_in" };

export function LoginForm({
  searchParamsPromise,
}: {
  searchParamsPromise: Promise<{ error?: string; sent?: string; next?: string }>;
}) {
  const initial = use(searchParamsPromise);
  const [mode, setMode] = useState<Mode>("signin");
  const [usePassword, setUsePassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>(
    initial.error
      ? { kind: "error", message: initial.error }
      : initial.sent
        ? { kind: "sent_magic", email: initial.sent }
        : { kind: "idle" },
  );
  const [pending, startTransition] = useTransition();

  const emailId = useId();
  const passwordId = useId();
  const headingId = "login-form-heading";

  const supabase = createClient();
  // Always use the live browser origin so OAuth round-trips land back on
  // the same environment the user started in. `NEXT_PUBLIC_SITE_URL` is
  // canonical (production) and would route dev sessions to the live site.
  const siteUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : (process.env.NEXT_PUBLIC_SITE_URL ?? "");

  // Sanitize the post-login destination. Must be a same-origin path,
  // anything starting with `//` or an absolute URL is rejected as an
  // open-redirect attempt. /my-beacon is the default landing for
  // logged-in users.
  const safeNext =
    initial.next && initial.next.startsWith("/") && !initial.next.startsWith("//")
      ? initial.next
      : "/my-beacon";
  // The OAuth/email flows redirect through /auth/callback which only
  // honors `?next=` for same-origin paths, so we forward the validated
  // path along for the round-trip back here from Supabase.
  const callbackUrl = `${siteUrl}/auth/callback?next=${encodeURIComponent(safeNext)}`;

  const signInWith = (provider: "google" | "discord") => {
    setStatus({ kind: "idle" });
    startTransition(async () => {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: callbackUrl },
      });
      if (error) setStatus({ kind: "error", message: error.message });
    });
  };

  const sendMagicLink = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email) return;
    setStatus({ kind: "idle" });
    startTransition(async () => {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: callbackUrl },
      });
      if (error) {
        setStatus({ kind: "error", message: error.message });
      } else {
        setStatus({ kind: "sent_magic", email });
      }
    });
  };

  const submitPassword = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email || !password) return;
    setStatus({ kind: "idle" });
    startTransition(async () => {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) {
          setStatus({ kind: "error", message: error.message });
        } else {
          setStatus({ kind: "signed_in" });
          // Hard-navigate so the server-rendered shell picks up the new
          // session cookie immediately instead of a stale auth state.
          window.location.assign(safeNext);
        }
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: callbackUrl },
        });
        if (error) {
          setStatus({ kind: "error", message: error.message });
        } else if (data.user && !data.session) {
          // Email confirmation required, Supabase will send the
          // confirmation link, no session yet.
          setStatus({ kind: "sent_confirm", email });
        } else {
          // Auto-confirm path (rare in production) → respect the next
          // round-trip just like password sign-in.
          setStatus({ kind: "signed_in" });
          window.location.assign(safeNext);
        }
      }
    });
  };

  return (
    <div
      className="relative overflow-hidden rounded-modal border border-line bg-surface p-6 sm:p-8"
      style={{
        boxShadow: "0 0 64px -32px rgba(168, 85, 247, 0.35)",
      }}
    >
      {/* Top-edge gradient accent to mark this as the primary action card. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent 0%, #A855F7 30%, #22D3EE 70%, transparent 100%)",
        }}
      />

      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
        {mode === "signin" ? "Welcome back" : "Get started"}
      </p>
      <h2
        id={headingId}
        className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl"
      >
        {mode === "signin"
          ? "Sign in to your account."
          : "Create a free account."}
      </h2>

      {/* OAuth row, horizontal on desktop, stacked on mobile per design. */}
      <div
        role="group"
        aria-label="Sign in with a provider"
        className="mt-6 flex flex-col gap-3 sm:flex-row"
      >
        <ProviderButton
          provider="google"
          onClick={() => signInWith("google")}
          disabled={pending}
        />
        <ProviderButton
          provider="discord"
          onClick={() => signInWith("discord")}
          disabled={pending}
        />
      </div>

      <Divider>or use your email</Divider>

      {/* Magic-link form. Same flow for sign-in and sign-up because
          Supabase's signInWithOtp auto-creates the user on first link
          click, works as both registration and login. */}
      <form onSubmit={sendMagicLink} className="space-y-3" noValidate>
        <label htmlFor={emailId} className="block text-sm font-medium">
          Email address
        </label>
        <input
          id={emailId}
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-card border border-line bg-base px-4 py-3 text-sm placeholder:text-ink-subtle focus:border-brand-purple focus:outline-none focus:ring-2 focus:ring-brand-purple/30"
        />

        {usePassword && (
          <div className="space-y-2">
            <label htmlFor={passwordId} className="block text-sm font-medium">
              Password
            </label>
            <input
              id={passwordId}
              name="password"
              type="password"
              autoComplete={
                mode === "signin" ? "current-password" : "new-password"
              }
              required
              minLength={mode === "signup" ? 8 : undefined}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={
                mode === "signup"
                  ? "At least 8 characters"
                  : "Your password"
              }
              className="w-full rounded-card border border-line bg-base px-4 py-3 text-sm placeholder:text-ink-subtle focus:border-brand-purple focus:outline-none focus:ring-2 focus:ring-brand-purple/30"
            />
          </div>
        )}

        {!usePassword ? (
          <>
            <button
              type="submit"
              disabled={pending || !email}
              className="inline-flex w-full min-h-11 items-center justify-center rounded-card bg-beacon px-4 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              {pending ? "Sending..." : "Email me a sign-in link"}
            </button>
            <p className="text-xs text-ink-subtle">
              No password required. We email you a one-time link.
            </p>
            <button
              type="button"
              onClick={() => setUsePassword(true)}
              className="text-xs font-medium text-brand-cyan hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Use a password instead
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={(event) => {
                // Submit via the password handler instead of the form's
                // magic-link submit handler.
                event.preventDefault();
                submitPassword(event as unknown as React.FormEvent<HTMLFormElement>);
              }}
              disabled={pending || !email || !password}
              className="inline-flex w-full min-h-11 items-center justify-center rounded-card bg-beacon px-4 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              {pending
                ? mode === "signin"
                  ? "Signing in..."
                  : "Creating account..."
                : mode === "signin"
                  ? "Sign in with password"
                  : "Create account"}
            </button>
            <button
              type="button"
              onClick={() => setUsePassword(false)}
              className="text-xs font-medium text-brand-cyan hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Use an email link instead
            </button>
          </>
        )}
      </form>

      {/* Status row (errors, magic-link sent, confirmation pending). */}
      <div aria-live="polite" className="mt-4 min-h-[1.25rem] text-sm">
        {status.kind === "error" && (
          <p
            role="alert"
            className="rounded-card border border-signal-danger/40 bg-signal-danger/10 px-3 py-2 text-signal-danger"
          >
            {status.message}
          </p>
        )}
        {status.kind === "sent_magic" && (
          <p className="rounded-card border border-signal-success/40 bg-signal-success/10 px-3 py-2 text-signal-success">
            Check <span className="font-semibold">{status.email}</span> for a
            sign-in link.
          </p>
        )}
        {status.kind === "sent_confirm" && (
          <p className="rounded-card border border-signal-success/40 bg-signal-success/10 px-3 py-2 text-signal-success">
            Almost there. We sent a confirmation link to{" "}
            <span className="font-semibold">{status.email}</span>. Click it to
            activate your account.
          </p>
        )}
      </div>

      {/* Mode toggle. Switches what "Use a password" submits as. */}
      <p className="mt-6 border-t border-line pt-4 text-center text-sm text-ink-muted">
        {mode === "signin" ? (
          <>
            Don&apos;t have an account?{" "}
            <button
              type="button"
              onClick={() => {
                setMode("signup");
                setStatus({ kind: "idle" });
              }}
              className="font-semibold text-brand-cyan hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Create one
            </button>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <button
              type="button"
              onClick={() => {
                setMode("signin");
                setStatus({ kind: "idle" });
              }}
              className="font-semibold text-brand-cyan hover:text-brand-purple focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
            >
              Sign in
            </button>
          </>
        )}
      </p>
    </div>
  );
}

/* ---------- OAuth provider button ---------- */

function ProviderButton({
  provider,
  onClick,
  disabled,
}: {
  provider: "google" | "discord";
  onClick: () => void;
  disabled: boolean;
}) {
  const label =
    provider === "google" ? "Continue with Google" : "Continue with Discord";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="inline-flex flex-1 min-h-11 items-center justify-center gap-2.5 rounded-card border border-line bg-base px-4 py-3 text-sm font-medium text-ink transition-colors hover:border-line-accent hover:bg-surface disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
    >
      <span aria-hidden="true" className="text-ink-muted">
        {provider === "google" ? <GoogleIcon /> : <DiscordIcon />}
      </span>
      <span>{label}</span>
    </button>
  );
}

/* ---------- Visual helpers ---------- */

function Divider({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      className="my-6 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle"
    >
      <span className="h-px flex-1 bg-line" aria-hidden="true" />
      <span>{children}</span>
      <span className="h-px flex-1 bg-line" aria-hidden="true" />
    </div>
  );
}

/* Flat, single-color brand glyphs. fill="currentColor" so the icon picks
   up the button's text color and stays neutral against the dark UI. */
function GoogleIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="currentColor"
      focusable="false"
      aria-hidden="true"
    >
      <path d="M12 11v3.2h5.35c-.23 1.32-.91 2.45-1.93 3.2v2.66h3.12c1.83-1.69 2.88-4.18 2.88-7.1 0-.65-.06-1.27-.17-1.96H12Zm0 11c2.43 0 4.47-.8 5.96-2.18l-3.12-2.66c-.86.58-1.97.92-2.84.92-2.18 0-4.03-1.47-4.69-3.44H4.13v2.16C5.66 19.78 8.59 22 12 22ZM7.31 14.64c-.17-.5-.27-1.05-.27-1.64s.1-1.14.27-1.64V9.2H4.13c-.66 1.31-1.04 2.78-1.04 4.4 0 1.62.38 3.09 1.04 4.4l3.18-3.36ZM12 5.83c1.32 0 2.5.45 3.43 1.34l2.57-2.57C16.46 3.05 14.42 2 12 2 8.59 2 5.66 4.22 4.13 7.4l3.18 2.16C7.97 7.3 9.82 5.83 12 5.83Z" />
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="currentColor"
      focusable="false"
      aria-hidden="true"
    >
      <path d="M19.27 5.33A18.85 18.85 0 0 0 15 4a.09.09 0 0 0-.07.03c-.18.33-.39.76-.53 1.09a16.09 16.09 0 0 0-4.8 0 11.39 11.39 0 0 0-.54-1.09.1.1 0 0 0-.07-.03 18.85 18.85 0 0 0-4.27 1.33.07.07 0 0 0-.03.02C1.97 9.4 1.22 13.36 1.6 17.28a.08.08 0 0 0 .05.05 19.4 19.4 0 0 0 5.24 2.65.08.08 0 0 0 .09-.03c.4-.55.76-1.13 1.07-1.74a.07.07 0 0 0-.04-.09 12.36 12.36 0 0 1-1.64-.78.07.07 0 0 1-.01-.13c.11-.08.22-.17.33-.25a.08.08 0 0 1 .08-.01c3.44 1.57 7.15 1.57 10.55 0a.08.08 0 0 1 .08.01c.11.09.22.17.33.26a.07.07 0 0 1-.01.13 12.36 12.36 0 0 1-1.64.78.07.07 0 0 0-.04.09c.32.61.68 1.19 1.07 1.74a.08.08 0 0 0 .09.03 19.34 19.34 0 0 0 5.25-2.65.08.08 0 0 0 .05-.05c.44-4.53-.73-8.46-3.1-11.95a.06.06 0 0 0-.04-.02ZM8.52 14.91c-1.03 0-1.89-.95-1.89-2.12 0-1.17.84-2.12 1.89-2.12 1.06 0 1.91.96 1.89 2.12 0 1.17-.84 2.12-1.89 2.12Zm6.97 0c-1.03 0-1.89-.95-1.89-2.12 0-1.17.84-2.12 1.89-2.12 1.06 0 1.91.96 1.89 2.12 0 1.17-.83 2.12-1.89 2.12Z" />
    </svg>
  );
}
