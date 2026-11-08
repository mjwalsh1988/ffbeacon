import { PulseLoader } from "@/components/PulseLoader";

/**
 * Route-level loading boundary for /games/long-shot, the Signal Scout shape:
 * the same <main id="main"> landmark, one polite status region announced
 * once, a decorative loader and real words naming the destination.
 */
export default function Loading() {
  return (
    <main id="main">
      <div className="flex min-h-[60vh] items-center justify-center px-4 sm:px-6 lg:px-8">
        <div role="status" aria-live="polite" className="flex flex-col items-center gap-4">
          <PulseLoader size={96} decorative />
          <p className="text-sm font-medium tracking-wide text-ink-muted">Loading Long Shot.</p>
        </div>
      </div>
    </main>
  );
}
