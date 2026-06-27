/**
 * Shared empty / loading / error blocks for On The Clock. Brand-consistent with
 * the rest of the site (League Pulse / FAAB): dashed-border empty cards, a
 * role="status" loading card, and a role="alert" danger card. No color-only
 * state: every block carries text.
 */

import { Loader2, AlertTriangle, Inbox } from "lucide-react";

export function LoadingCard({ label = "Loading draft..." }: { label?: string }) {
  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-card border border-line bg-surface/60 p-6 text-sm text-ink-muted"
    >
      <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin text-brand-cyan" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorCard({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-card border border-signal-danger/40 bg-signal-danger/10 p-4 text-sm text-signal-danger"
    >
      <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
      <p>{message}</p>
    </div>
  );
}

export function EmptyCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex items-start gap-4 rounded-card border border-dashed border-line bg-base/40 p-6">
      <span
        aria-hidden="true"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card border border-line bg-surface text-brand-cyan"
      >
        <Inbox className="h-5 w-5" />
      </span>
      <div>
        <p className="text-base font-semibold text-ink">{title}</p>
        <p className="mt-1 text-sm leading-relaxed text-ink-muted">{body}</p>
      </div>
    </div>
  );
}
