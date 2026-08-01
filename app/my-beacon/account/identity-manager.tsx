"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2, Link2Off, ShieldCheck, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/**
 * Shape of the minimum identity fields this component needs. We only pass
 * the safe subset from the server (no provider_id, no email blob), the
 * unlink call uses `identity_id` which is the authoritative key.
 */
export type IdentityRow = {
  identity_id: string;
  provider: string;
  email: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
};

type Provider = "google" | "discord";

type ManageableProvider = {
  provider: Provider;
  label: string;
  description: string;
  Icon: React.ComponentType<{ className?: string }>;
};

const PROVIDERS: ManageableProvider[] = [
  {
    provider: "google",
    label: "Google",
    description: "Sign in with your Google account.",
    Icon: GoogleIcon,
  },
  {
    provider: "discord",
    label: "Discord",
    description: "Sign in with your Discord account.",
    Icon: DiscordIcon,
  },
];

type Status =
  | { kind: "idle" }
  | { kind: "linking"; provider: string }
  | { kind: "unlinking"; provider: string }
  | { kind: "error"; message: string }
  | { kind: "success"; message: string };

export function IdentityManager({
  identities,
  hasPassword,
  accountEmail,
}: {
  identities: IdentityRow[];
  /** True when the user can sign in by email (magic link OR password).
   * `hasPassword` is more accurate than `identities.some(p === "email")`
   * because an OAuth-only user who later sets a password gets the
   * password stored on auth.users WITHOUT a matching identity row. */
  hasPassword: boolean;
  /** Falls back to the auth.users email when no email identity exists,
   * so the row still shows a recognizable address. */
  accountEmail: string | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [pending, startTransition] = useTransition();
  const statusId = useId();

  const supabase = createClient();
  // ALWAYS prefer the live browser origin in a client component, the user
  // is physically on `window.location.origin`, so that's the only URL the
  // OAuth callback can come back to without cross-environment surprises.
  // `NEXT_PUBLIC_SITE_URL` is canonical / production-only and would route
  // dev sessions back to the live site (verified: an unguarded dev test
  // shipped users to prod after Discord linking). Server-side fallback is
  // kept for completeness, but this code only runs in the browser today.
  const siteUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : (process.env.NEXT_PUBLIC_SITE_URL ?? "");
  // Round-trip the user back to /my-beacon/account after the OAuth dance
  // so they see their newly-linked identity reflected in the list.
  const callbackUrl = `${siteUrl}/auth/callback?next=${encodeURIComponent("/my-beacon/account")}`;

  // Email + password identity is shown separately (it's not in PROVIDERS)
  // so the OAuth section only renders Google/Discord rows.
  const emailIdentity =
    identities.find((id) => id.provider === "email") ?? null;
  const oauthIdentityCount = identities.filter((id) =>
    PROVIDERS.some((p) => p.provider === id.provider),
  ).length;

  const link = (provider: Provider) => {
    setStatus({ kind: "linking", provider });
    // linkIdentity uses a different Supabase endpoint than signInWithOAuth
    // and does not reliably preserve the `?next=` we encode into redirectTo
    // (the login flow does, but link doesn't). As a belt-and-braces backup,
    // stash the return path in a short-lived cookie that the auth callback
    // checks before falling back to the default home redirect.
    document.cookie = `ff_oauth_return=${encodeURIComponent("/my-beacon/account")}; Path=/; Max-Age=600; SameSite=Lax`;
    startTransition(async () => {
      const { error } = await supabase.auth.linkIdentity({
        provider,
        options: { redirectTo: callbackUrl },
      });
      if (error) {
        setStatus({ kind: "error", message: error.message });
      }
      // On success Supabase redirects the browser, no further state to set.
    });
  };

  const unlink = (identity: IdentityRow) => {
    // Guard the last login method client-side; the server (Supabase) also
    // refuses to unlink the only remaining identity, but a clear message
    // here is friendlier than a generic API error.
    const remainingOauth = oauthIdentityCount - 1;
    if (!hasPassword && remainingOauth < 1) {
      setStatus({
        kind: "error",
        message:
          "Can't disconnect your only sign-in method. Set a password first or link another provider.",
      });
      return;
    }

    setStatus({ kind: "unlinking", provider: identity.provider });
    startTransition(async () => {
      // Supabase's unlinkIdentity expects the full UserIdentity object
      // shape, but only `identity_id`, `user_id`, and `provider` are
      // actually used. We pass the minimum and cast.
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setStatus({ kind: "error", message: "Not signed in" });
        return;
      }
      const { error } = await supabase.auth.unlinkIdentity({
        identity_id: identity.identity_id,
        id: identity.identity_id,
        user_id: user.id,
        provider: identity.provider,
        identity_data: {},
        created_at: identity.created_at ?? "",
        last_sign_in_at: identity.last_sign_in_at ?? "",
        updated_at: identity.created_at ?? "",
      });
      if (error) {
        setStatus({ kind: "error", message: error.message });
      } else {
        setStatus({
          kind: "success",
          message: `${labelFor(identity.provider)} disconnected.`,
        });
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-3">
      <ul role="list" className="space-y-3">
        {/* Email / password row, always visible. Read-only here because
            disconnecting the email identity would orphan password resets
            and magic links; users manage the email address itself and
            password separately in the sections below. */}
        <li className="flex flex-col gap-3 rounded-card border border-line bg-surface/60 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card border border-line bg-base text-ink"
            >
              <Mail className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">
                Email &amp; password
              </p>
              {hasPassword ? (
                <p className="text-xs text-ink-muted">
                  <span className="inline-flex items-center gap-1 text-signal-success">
                    <ShieldCheck aria-hidden="true" className="h-3 w-3" />
                    Active
                  </span>
                  {(emailIdentity?.email ?? accountEmail) && (
                    <>
                      <span aria-hidden="true">, </span>
                      <span className="break-all">
                        {emailIdentity?.email ?? accountEmail}
                      </span>
                    </>
                  )}
                  <span className="mt-1 block text-ink-subtle">
                    {emailIdentity
                      ? "Magic links, password sign-in, and password resets."
                      : "Password sign-in and password resets."}
                  </span>
                </p>
              ) : (
                <p className="text-xs text-ink-muted">
                  Not set up. Add a password below to enable email sign-in
                  as a backup.
                </p>
              )}
            </div>
          </div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-subtle sm:text-right">
            Managed below
          </p>
        </li>
        {PROVIDERS.map(({ provider, label, description, Icon }) => {
          const existing = identities.find((id) => id.provider === provider);
          const isLinked = Boolean(existing);
          return (
            <li
              key={provider}
              className="flex flex-col gap-3 rounded-card border border-line bg-surface/60 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card border border-line bg-base text-ink"
                >
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">{label}</p>
                  {isLinked ? (
                    <p className="text-xs text-ink-muted">
                      <span className="inline-flex items-center gap-1 text-signal-success">
                        <ShieldCheck aria-hidden="true" className="h-3 w-3" />
                        Connected
                      </span>
                      {existing?.email && (
                        <>
                          <span aria-hidden="true">, </span>
                          <span className="break-all">{existing.email}</span>
                        </>
                      )}
                    </p>
                  ) : (
                    <p className="text-xs text-ink-muted">{description}</p>
                  )}
                </div>
              </div>
              {isLinked ? (
                <button
                  type="button"
                  onClick={() => existing && unlink(existing)}
                  disabled={pending}
                  aria-label={`Disconnect ${label} from your account`}
                  aria-describedby={statusId}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-card border border-line bg-base px-4 text-sm font-medium text-ink-muted transition-colors hover:border-signal-danger/60 hover:text-signal-danger disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  <Link2Off aria-hidden="true" className="h-4 w-4" />
                  {status.kind === "unlinking" && status.provider === provider
                    ? "Disconnecting..."
                    : "Disconnect"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => link(provider)}
                  disabled={pending}
                  aria-label={`Connect ${label} to your account`}
                  aria-describedby={statusId}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-card border border-line bg-base px-4 text-sm font-medium text-ink transition-colors hover:border-line-accent disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
                >
                  <Link2 aria-hidden="true" className="h-4 w-4" />
                  {status.kind === "linking" && status.provider === provider
                    ? "Redirecting..."
                    : "Connect"}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <div
        id={statusId}
        aria-live="polite"
        role="status"
        className="min-h-[1.25rem] text-sm"
      >
        {status.kind === "error" && (
          <p
            role="alert"
            className="rounded-card border border-signal-danger/40 bg-signal-danger/10 px-3 py-2 text-signal-danger"
          >
            {status.message}
          </p>
        )}
        {status.kind === "success" && (
          <p className="rounded-card border border-signal-success/40 bg-signal-success/10 px-3 py-2 text-signal-success">
            {status.message}
          </p>
        )}
      </div>
    </div>
  );
}

function labelFor(provider: string): string {
  if (provider === "google") return "Google";
  if (provider === "discord") return "Discord";
  if (provider === "email") return "Email";
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

/* ---------- Icons (matched to login-form for visual consistency) ---------- */

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M12 11v3.2h5.35c-.23 1.32-.91 2.45-1.93 3.2v2.66h3.12c1.83-1.69 2.88-4.18 2.88-7.1 0-.65-.06-1.27-.17-1.96H12Zm0 11c2.43 0 4.47-.8 5.96-2.18l-3.12-2.66c-.86.58-1.97.92-2.84.92-2.18 0-4.03-1.47-4.69-3.44H4.13v2.16C5.66 19.78 8.59 22 12 22ZM7.31 14.64c-.17-.5-.27-1.05-.27-1.64s.1-1.14.27-1.64V9.2H4.13c-.66 1.31-1.04 2.78-1.04 4.4 0 1.62.38 3.09 1.04 4.4l3.18-3.36ZM12 5.83c1.32 0 2.5.45 3.43 1.34l2.57-2.57C16.46 3.05 14.42 2 12 2 8.59 2 5.66 4.22 4.13 7.4l3.18 2.16C7.97 7.3 9.82 5.83 12 5.83Z" />
    </svg>
  );
}

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M19.27 5.33A18.85 18.85 0 0 0 15 4a.09.09 0 0 0-.07.03c-.18.33-.39.76-.53 1.09a16.09 16.09 0 0 0-4.8 0 11.39 11.39 0 0 0-.54-1.09.1.1 0 0 0-.07-.03 18.85 18.85 0 0 0-4.27 1.33.07.07 0 0 0-.03.02C1.97 9.4 1.22 13.36 1.6 17.28a.08.08 0 0 0 .05.05 19.4 19.4 0 0 0 5.24 2.65.08.08 0 0 0 .09-.03c.4-.55.76-1.13 1.07-1.74a.07.07 0 0 0-.04-.09 12.36 12.36 0 0 1-1.64-.78.07.07 0 0 1-.01-.13c.11-.08.22-.17.33-.25a.08.08 0 0 1 .08-.01c3.44 1.57 7.15 1.57 10.55 0a.08.08 0 0 1 .08.01c.11.09.22.17.33.26a.07.07 0 0 1-.01.13 12.36 12.36 0 0 1-1.64.78.07.07 0 0 0-.04.09c.32.61.68 1.19 1.07 1.74a.08.08 0 0 0 .09.03 19.34 19.34 0 0 0 5.25-2.65.08.08 0 0 0 .05-.05c.44-4.53-.73-8.46-3.1-11.95a.06.06 0 0 0-.04-.02ZM8.52 14.91c-1.03 0-1.89-.95-1.89-2.12 0-1.17.84-2.12 1.89-2.12 1.06 0 1.91.96 1.89 2.12 0 1.17-.84 2.12-1.89 2.12Zm6.97 0c-1.03 0-1.89-.95-1.89-2.12 0-1.17.84-2.12 1.89-2.12 1.06 0 1.91.96 1.89 2.12 0 1.17-.83 2.12-1.89 2.12Z" />
    </svg>
  );
}
