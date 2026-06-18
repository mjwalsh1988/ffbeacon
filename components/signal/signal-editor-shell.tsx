import { SignalEditorSubNav } from "@/components/signal/signal-editor-subnav";

/**
 * Consistent shell for every My Signal editor sub-page: the secondary nav, then
 * the page's section heading and a plain-language intro, then its controls. The
 * H1 is owned by the My Beacon layout hero (rendered on every page), so each
 * sub-page's title is an H2, keeping a single H1 per page for screen readers.
 */
export function SignalEditorShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-8">
      <SignalEditorSubNav />
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-cyan">
          My Signal
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          {title}
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-muted">
          {description}
        </p>
      </header>
      {children}
    </div>
  );
}
