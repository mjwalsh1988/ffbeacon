import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ShieldCheck, KeyRound, Link2, Mail, Monitor } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { IdentityManager, type IdentityRow } from "./identity-manager";
import { PasswordForm } from "./password-form";
import { EmailForm } from "./email-form";
import { SessionsList, type SessionRow } from "./sessions-list";
import { SITE_TIME_ZONE } from "@/lib/datetime";

export const metadata: Metadata = {
  title: "Account Settings",
  description:
    "Manage your FF Beacon account: linked sign-in providers, password, email, and active sessions.",
};

export default async function AccountSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Layout already redirects unauthenticated users, but TS doesn't know
  // that, the assertion keeps the rest of the function null-free.
  if (!user) return null;

  // The user object from getUser() includes the identities array directly,
  // but we map to a narrow shape so we never leak provider_id or
  // identity_data downstream to the client.
  const identities: IdentityRow[] = (user.identities ?? []).map((id) => ({
    identity_id: id.identity_id ?? id.id,
    provider: id.provider,
    // identity_data is typed `Record<string, unknown> | undefined`; the
    // email field exists for email/Google/Discord providers in practice.
    email:
      (id.identity_data && (id.identity_data as { email?: string }).email) ??
      null,
    created_at: id.created_at ?? null,
    last_sign_in_at: id.last_sign_in_at ?? null,
  }));

  // Sessions can't be read via PostgREST directly (the `auth` schema isn't
  // exposed). The SECURITY DEFINER function `get_my_active_sessions`
  // filters by `auth.uid()` so we just call it with the user's own client.
  // `account_has_password` is the same pattern, used to detect OAuth-only
  // accounts that have since set a password (which does NOT create an
  // `email` identity, so `user.identities` alone undercounts methods).
  const [{ data: rawSessions }, { data: hasPasswordRpc }] = await Promise.all([
    supabase.rpc("get_my_active_sessions"),
    supabase.rpc("account_has_password"),
  ]);

  // Identify the current request's session row via the Supabase auth
  // cookie. The cookie value is a JSON-encoded array; the first element
  // is the access token, which has the session id under `session_id`.
  const cookieStore = await cookies();
  const currentSessionId = await getCurrentSessionId(cookieStore);

  const sessions: SessionRow[] = (rawSessions ?? []).map((s) => ({
    id: s.id,
    created_at: s.created_at,
    updated_at: s.updated_at,
    refreshed_at: s.refreshed_at,
    not_after: s.not_after,
    user_agent: s.user_agent,
    // `ip` comes back as the Postgres `inet` type, supabase-js types
    // it as `unknown`. It serializes as a string in practice.
    ip: typeof s.ip === "string" ? s.ip : null,
    is_current: s.id === currentSessionId,
  }));

  // Treat the account as having password-based sign-in if EITHER an
  // `email` identity exists (email/magic-link signups) OR the user row
  // carries a password (OAuth-only signups that later set one).
  const hasEmailIdentity = identities.some((id) => id.provider === "email");
  const hasPassword = hasEmailIdentity || hasPasswordRpc === true;
  // For the overview list, treat password-without-email-identity as if it
  // were an "email" method so the count + caption stay coherent. Dedupe
  // because a magic-link account already has provider="email".
  const methodProviders = hasEmailIdentity
    ? identities.map((id) => id.provider)
    : hasPassword
      ? ["email", ...identities.map((id) => id.provider)]
      : identities.map((id) => id.provider);
  const emailConfirmedAt = user.email_confirmed_at ?? null;
  const lastSignInAt = user.last_sign_in_at ?? null;
  const createdAt = user.created_at ?? null;

  return (
    <div className="space-y-6">
      <AccountOverviewSection
        email={user.email ?? null}
        emailConfirmedAt={emailConfirmedAt}
        createdAt={createdAt}
        lastSignInAt={lastSignInAt}
        providers={methodProviders}
        sessionCount={sessions.length}
      />

      <Section
        eyebrow="Connected accounts"
        heading="Sign-in providers"
        description="Link Google or Discord so you can sign in with one click from any device. You can disconnect any provider, as long as you have at least one other way to sign in."
        icon={Link2}
        bodyId="providers-body"
      >
        <IdentityManager
          identities={identities}
          hasPassword={hasPassword}
          accountEmail={user.email ?? null}
        />
      </Section>

      <Section
        eyebrow="Security"
        heading={hasPassword ? "Change your password" : "Set a password"}
        description={
          hasPassword
            ? "Use a unique password you don't reuse anywhere else. Updating it signs out all other sessions for safety."
            : "You currently sign in only with social providers. Setting a password gives you a backup if a provider is unavailable."
        }
        icon={KeyRound}
        bodyId="password-body"
      >
        <PasswordForm hasPassword={hasPassword} email={user.email ?? null} />
      </Section>

      <Section
        eyebrow="Contact"
        heading="Email on file"
        description="This is the address we use for confirmations, magic links, and password resets."
        icon={Mail}
        bodyId="email-body"
      >
        <EmailForm currentEmail={user.email ?? null} />
      </Section>

      <Section
        eyebrow="Active sessions"
        heading="Where you're signed in"
        description="Each row is a browser or device with an active FF Beacon session. Sign out anything you don't recognize."
        icon={Monitor}
        bodyId="sessions-body"
      >
        {sessions.length > 0 ? (
          <SessionsList sessions={sessions} />
        ) : (
          <p className="rounded-card border border-dashed border-line bg-base/40 p-6 text-sm text-ink-muted">
            No active sessions visible. (You may need to sign in again on this
            device.)
          </p>
        )}
      </Section>
    </div>
  );
}

/* ---------- Sections ---------- */

function AccountOverviewSection({
  email,
  emailConfirmedAt,
  createdAt,
  lastSignInAt,
  providers,
  sessionCount,
}: {
  email: string | null;
  emailConfirmedAt: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
  providers: string[];
  sessionCount: number;
}) {
  // Render the providers as a human list so the count and the caption
  // tell the same story (e.g. value="2" + caption="Email, Google").
  const labeled = providers.map(providerDisplayName);
  const methodsCaption =
    labeled.length === 0
      ? "None connected yet."
      : labeled.length === 1
        ? `${labeled[0]} only.`
        : `${labeled.join(", ")}.`;

  const cards = [
    {
      label: "Account email",
      value: email ?? "-",
      caption: emailConfirmedAt ? "Confirmed" : "Awaiting confirmation",
    },
    {
      label: "Sign-in methods",
      value: providers.length.toString(),
      caption: methodsCaption,
    },
    {
      label: "Active sessions",
      value: sessionCount.toString(),
      caption:
        sessionCount === 1
          ? "Only this device."
          : `Across ${sessionCount} browsers / devices.`,
    },
    {
      label: "Last sign-in",
      value: formatShortDate(lastSignInAt),
      caption: `Member since ${formatShortDate(createdAt)}.`,
    },
  ];

  return (
    <section aria-labelledby="account-overview-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <SectionEyebrow>Account</SectionEyebrow>
          <h2
            id="account-overview-heading"
            className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl"
          >
            Account at a glance.
          </h2>
        </div>
        <p className="inline-flex items-center gap-1.5 text-sm text-ink-muted">
          <ShieldCheck
            aria-hidden="true"
            className="h-4 w-4 text-signal-success"
          />
          End-to-end encrypted sessions
        </p>
      </div>

      <ul
        role="list"
        className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4"
      >
        {cards.map((card) => (
          <li
            key={card.label}
            className="rounded-card border border-line bg-surface/60 p-4"
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
              {card.label}
            </p>
            <p className="mt-2 break-words text-base font-semibold text-ink sm:text-lg">
              {card.value}
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
              {card.caption}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Section({
  eyebrow,
  heading,
  description,
  icon: Icon,
  bodyId,
  children,
}: {
  eyebrow: string;
  heading: string;
  description: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  bodyId: string;
  children: React.ReactNode;
}) {
  const headingId = `${bodyId}-heading`;
  return (
    <section aria-labelledby={headingId}>
      <div className="grid gap-6 lg:grid-cols-[1fr_2fr] lg:gap-10">
        <div>
          <SectionEyebrow>
            <span className="inline-flex items-center gap-1.5">
              <Icon aria-hidden className="h-3.5 w-3.5" />
              {eyebrow}
            </span>
          </SectionEyebrow>
          <h2
            id={headingId}
            className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl"
          >
            {heading}
          </h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-muted">
            {description}
          </p>
        </div>
        <div
          id={bodyId}
          className="rounded-card border border-line bg-surface p-5 sm:p-6"
        >
          {children}
        </div>
      </div>
    </section>
  );
}

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
      {children}
    </p>
  );
}

/* ---------- Helpers ---------- */

function providerDisplayName(provider: string): string {
  if (provider === "email") return "Email";
  if (provider === "google") return "Google";
  if (provider === "discord") return "Discord";
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function formatShortDate(iso: string | null): string {
  if (!iso) return "-";
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: SITE_TIME_ZONE,
    }).format(new Date(iso));
  } catch {
    return "-";
  }
}

/**
 * Decode the Supabase auth cookie to extract the access-token session_id
 * for the request that hit this page. Used to mark the matching row in
 * the sessions list as "This device". Returns null on any decode failure,
 * the UI just won't label a current session, which is acceptable.
 */
async function getCurrentSessionId(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
): Promise<string | null> {
  // Find the Supabase auth cookie. The name pattern is
  // `sb-<project-ref>-auth-token` plus chunked variants for large tokens.
  const authCookie = cookieStore
    .getAll()
    .find(
      (c) =>
        c.name.startsWith("sb-") &&
        c.name.endsWith("-auth-token") &&
        !c.name.includes(".") /* skip chunk suffixes like .0 */,
    );
  if (!authCookie?.value) return null;

  try {
    // The cookie may be base64-prefixed (Supabase SSR uses `base64-` prefix
    // to indicate base64-encoded JSON). Strip the prefix before decoding.
    let raw = authCookie.value;
    if (raw.startsWith("base64-")) {
      raw = Buffer.from(raw.slice("base64-".length), "base64").toString("utf8");
    }
    const parsed = JSON.parse(raw) as
      | { access_token?: string }
      | [string, ...unknown[]];
    const accessToken = Array.isArray(parsed)
      ? typeof parsed[0] === "string"
        ? parsed[0]
        : null
      : (parsed.access_token ?? null);
    if (!accessToken) return null;
    // JWT payload is the middle segment. Decode base64url → utf8.
    const segments = accessToken.split(".");
    if (segments.length < 2) return null;
    const payloadB64 = segments[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payloadB64 + "=".repeat((4 - (payloadB64.length % 4)) % 4);
    const payload = JSON.parse(
      Buffer.from(padded, "base64").toString("utf8"),
    ) as { session_id?: string };
    return payload.session_id ?? null;
  } catch {
    return null;
  }
}
