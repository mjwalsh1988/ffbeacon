/**
 * The Lone Signal badge (plan 18A.11): the words and a radio tower, cyan,
 * with a soft pulse on the icon only, removed under reduced motion.
 */

import { RadioTower } from "lucide-react";

export function LoneSignalBadge({ label = "Lone Signal" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-cyan/60 bg-brand-cyan/10 px-3 py-1 text-sm font-semibold text-brand-cyan">
      <RadioTower aria-hidden="true" className="h-4 w-4 animate-pulse motion-reduce:animate-none" />
      {label}
    </span>
  );
}
