import { PulseLoader } from "@/components/PulseLoader";

/**
 * Root loading boundary. Next.js renders this instantly on navigation while
 * the target route's server component awaits its data, then streams the real
 * page in. It fills the content slot of the root layout, so the site header
 * and footer stay on screen during the wait.
 *
 * Presentation: a full-viewport flex container (100dvh, centered on both axes
 * so mobile browser chrome can't push it off-center) holds a contained card.
 * The card is the single live region: role="status" + aria-live="polite" with
 * a real "Loading..." text label, so screen readers announce it once. The
 * PulseLoader inside is decorative (the card owns the announcement).
 *
 * All colors come from brand tokens (bg-surface-elevated, border-line,
 * text-ink-muted, rounded-modal); no hex is hardcoded.
 */
export default function Loading() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-4">
      <div
        role="status"
        aria-live="polite"
        className="flex flex-col items-center gap-5 rounded-modal border border-line bg-surface-elevated px-10 py-12 shadow-2xl shadow-black/40"
      >
        <PulseLoader size={96} decorative />
        <p className="text-sm font-medium tracking-wide text-ink-muted">
          Loading...
        </p>
      </div>
    </div>
  );
}
