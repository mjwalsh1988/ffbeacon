/**
 * A tier pill (plan 18A.8): icon, word, tier-colored border and a 15 percent
 * tint. A miss is a red border and the word "Miss", with no icon. The word is
 * always present, so nothing depends on the color.
 */

import { MISS_STYLE, TIER_STYLE, tierIcon } from "@/lib/long-shot/tier-style";
import type { Tier } from "@/lib/long-shot/types";

export function TierChip({ tier, size = "md" }: { tier: Tier | null; size?: "sm" | "md" }) {
  const Icon = tierIcon(tier);
  const style = tier ? TIER_STYLE[tier] : null;
  const pad = size === "sm" ? "px-2.5 py-0.5 text-xs" : "px-3 py-1 text-sm";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-semibold ${pad} ${
        style ? `${style.border} ${style.tint}` : MISS_STYLE.border
      }`}
    >
      {Icon && (
        <Icon aria-hidden="true" className="h-4 w-4 shrink-0" style={{ color: style?.hex }} strokeWidth={2.2} />
      )}
      <span className={tier === "long_shot" ? TIER_STYLE.long_shot.text : style ? "text-ink" : MISS_STYLE.text}>
        {style ? style.word : MISS_STYLE.word}
      </span>
    </span>
  );
}
