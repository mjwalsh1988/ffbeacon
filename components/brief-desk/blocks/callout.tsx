/**
 * callout: a short aside with an icon, for a rule of thumb or a caveat. The
 * icon is decorative and the caption is the aside's accessible name; the tone
 * colours a border and is paired with the text, never the only signal.
 *
 * Server component.
 */

import type { SectionIcon } from "@/lib/brief-desk/blocks";
import { sectionIcon } from "@/components/brief-desk/section-icons";

const TONES = {
  cyan: { color: "#22D3EE", border: "border-brand-cyan/50", text: "text-brand-cyan" },
  purple: { color: "#A855F7", border: "border-brand-purple/50", text: "text-brand-purple" },
} as const;

export function CalloutBlock({
  id,
  caption,
  conclusion,
  options,
}: {
  id: string;
  caption: string;
  conclusion: string;
  options: { icon: SectionIcon; tone: "cyan" | "purple" };
}) {
  const Icon = sectionIcon(options.icon);
  const tone = TONES[options.tone];
  const labelId = `block-${id}-caption`;
  return (
    <aside
      aria-labelledby={labelId}
      className={`my-6 rounded-card border-l-4 ${tone.border} bg-surface p-4 sm:p-5`}
    >
      <p id={labelId} className={`flex items-center gap-2 text-sm font-semibold ${tone.text}`}>
        {Icon && <Icon aria-hidden="true" className="h-4 w-4" />}
        {caption || "Note"}
      </p>
      {conclusion && <p className="mt-1.5 text-sm leading-relaxed text-ink-muted sm:text-base">{conclusion}</p>}
    </aside>
  );
}
