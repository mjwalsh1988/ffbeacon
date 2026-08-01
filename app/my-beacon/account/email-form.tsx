"use client";

import { useId, useState, useTransition } from "react";
import { Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Status =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "sent"; email: string };

/**
 * Email change form. Supabase doesn't perform the swap immediately,
 * it sends a confirmation link to BOTH the old and new addresses, and
 * the change only takes effect after the user clicks both links.
 * We reflect that in the success message so users aren't confused when
 * the displayed email doesn't change instantly.
 */
export function EmailForm({ currentEmail }: { currentEmail: string | null }) {
  const supabase = createClient();
  const [email, setEmail] = useState(currentEmail ?? "");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  const emailId = useId();
  const statusId = useId();

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleaned = email.trim().toLowerCase();
    if (!cleaned || cleaned === (currentEmail ?? "").toLowerCase()) return;
    setStatus({ kind: "idle" });

    startTransition(async () => {
      const { error } = await supabase.auth.updateUser({ email: cleaned });
      if (error) {
        setStatus({ kind: "error", message: error.message });
      } else {
        setStatus({ kind: "sent", email: cleaned });
      }
    });
  };

  const disabled =
    pending ||
    !email.trim() ||
    email.trim().toLowerCase() === (currentEmail ?? "").toLowerCase();

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div>
        <label htmlFor={emailId} className="block text-sm font-medium text-ink">
          Email address
        </label>
        <input
          id={emailId}
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-describedby={`${emailId}-hint ${statusId}`}
          className="mt-2 w-full rounded-card border border-line bg-base px-3 py-3 text-sm placeholder:text-ink-subtle focus:border-brand-purple focus:outline-none focus:ring-2 focus:ring-brand-purple/30"
        />
        <p id={`${emailId}-hint`} className="mt-1 text-xs text-ink-subtle">
          Changing your email sends a confirmation link to both the old and
          new addresses. The change only takes effect once both are confirmed.
        </p>
      </div>

      <button
        type="submit"
        disabled={disabled}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-card border border-line bg-surface-elevated px-5 text-sm font-semibold text-ink transition-colors hover:border-line-accent disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan"
      >
        <Mail aria-hidden="true" className="h-4 w-4" />
        {pending ? "Sending confirmation..." : "Update email"}
      </button>

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
        {status.kind === "sent" && (
          <p className="rounded-card border border-signal-success/40 bg-signal-success/10 px-3 py-2 text-signal-success">
            Confirmation sent to{" "}
            <span className="font-semibold break-all">{status.email}</span> and
            your current address. Click both links to finish the switch.
          </p>
        )}
      </div>
    </form>
  );
}
