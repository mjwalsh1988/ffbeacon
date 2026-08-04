"use client";

import { Eye, EyeOff, Star } from "lucide-react";

/**
 * The two profile controls on a My Sleeper Leagues row: Featured, and Shown on
 * profile.
 *
 * WHY CIRCLES WITH NO WORDS
 *   They used to be pill buttons carrying their own labels, which cost the table
 *   two whole columns. On a six-column table holding league names, a status, a
 *   team count, and two standing pills, that is the width the league names
 *   wanted. Stacked in the League cell they take about 36px of it instead.
 *
 * STATE IS CARRIED TWICE OVER, NEVER BY COLOUR ALONE
 *   Featured fills the star and turns it amber; unfeatured is the same star as an
 *   outline in the site's cyan accent. Shown is an eye with a wash of colour
 *   inside it; hidden is the eye with a line through it. So the shape changes,
 *   the fill changes, and only then the hue. Someone who cannot separate amber
 *   from cyan still has a solid star against an outlined one.
 *
 * TWO SHAPES
 *   `stack` is the bare vertical pair for the desktop table, where there is no
 *   room for words and the row provides the context.
 *   `list` is the labelled pair for the mobile sheet, where there is room and an
 *   icon with no word beside it is a guess.
 *
 * In `list` the visible word is also the start of the accessible name, which is
 * WCAG 2.5.3: a control whose visible label and spoken label disagree cannot be
 * operated by voice. `role="switch"` plus `aria-checked` carries on and off, so
 * the name does not repeat it.
 */

const SIZE = {
  /** Desktop table. A mouse pointer, so 36px is generous. */
  sm: { button: "h-9 w-9", icon: "h-4 w-4" },
  /** Mobile sheet. A finger, so the 44px floor applies. */
  md: { button: "h-11 w-11", icon: "h-[18px] w-[18px]" },
} as const;

type ToggleSize = keyof typeof SIZE;
type ToggleVariant = "stack" | "list";

const BASE =
  "inline-flex shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-cyan";

/** Off is never a dimmed grey: on a near-black page that reads as disabled
 *  rather than as off, and these are always operable. */
const OFF_TONE =
  "border-line-accent bg-base/60 text-brand-cyan hover:border-brand-cyan/60 hover:bg-brand-cyan/10";

const FEATURED_ON_TONE =
  "border-signal-warning/70 bg-signal-warning/15 text-signal-warning shadow-[0_0_16px_-6px_rgba(245,158,11,0.9)] hover:bg-signal-warning/25";

const SHOWN_ON_TONE =
  "border-brand-cyan/70 bg-brand-cyan/15 text-brand-cyan shadow-[0_0_16px_-6px_rgba(34,211,238,0.9)] hover:bg-brand-cyan/25";

/** The wash inside a "shown" eye. Translucent on purpose: a solid fill closes
 *  the pupil up and the glyph stops reading as an eye. */
const EYE_WASH = "rgba(34, 211, 238, 0.22)";

export function FeaturedStarToggle({
  leagueName,
  isFeatured,
  onChange,
  size = "sm",
  variant = "stack",
}: {
  leagueName: string;
  isFeatured: boolean;
  onChange: (next: boolean) => void;
  size?: ToggleSize;
  variant?: ToggleVariant;
}) {
  const dims = SIZE[size];
  return (
    <CircleSwitch
      checked={isFeatured}
      onChange={onChange}
      variant={variant}
      dims={dims}
      tone={isFeatured ? FEATURED_ON_TONE : OFF_TONE}
      visibleLabel="Featured"
      ariaLabel={
        variant === "list"
          ? `Featured. ${leagueName}. Only one league can be featured at a time.`
          : isFeatured
            ? `Featured league. Tap to unfeature ${leagueName}.`
            : `Feature ${leagueName} on your profile. Only one league can be featured at a time.`
      }
      title={
        isFeatured ? "Featured. Tap to unfeature." : "Feature this league."
      }
      icon={
        <Star
          aria-hidden="true"
          className={dims.icon}
          fill={isFeatured ? "currentColor" : "none"}
        />
      }
    />
  );
}

export function ShownEyeToggle({
  leagueName,
  isShown,
  onChange,
  size = "sm",
  variant = "stack",
}: {
  leagueName: string;
  isShown: boolean;
  onChange: (next: boolean) => void;
  size?: ToggleSize;
  variant?: ToggleVariant;
}) {
  const dims = SIZE[size];
  const Icon = isShown ? Eye : EyeOff;
  return (
    <CircleSwitch
      checked={isShown}
      onChange={onChange}
      variant={variant}
      dims={dims}
      tone={isShown ? SHOWN_ON_TONE : OFF_TONE}
      visibleLabel="Shown on profile"
      ariaLabel={
        variant === "list"
          ? `Shown on profile. ${leagueName}.`
          : isShown
            ? `Visible on profile. Tap to hide ${leagueName}.`
            : `Hidden from profile. Tap to show ${leagueName}.`
      }
      title={
        isShown
          ? "Shown on your profile. Tap to hide."
          : "Hidden from your profile. Tap to show."
      }
      icon={
        <Icon
          aria-hidden="true"
          className={dims.icon}
          fill={isShown ? EYE_WASH : "none"}
        />
      }
    />
  );
}

/**
 * Both controls together. Vertical in the table so they cost one column's width
 * rather than two, and a labelled list in the sheet.
 */
export function LeagueProfileToggles({
  leagueName,
  isFeatured,
  isShown,
  onSetFeatured,
  onToggleShown,
  variant = "stack",
  className = "",
}: {
  leagueName: string;
  isFeatured: boolean;
  isShown: boolean;
  onSetFeatured: (next: boolean) => void;
  onToggleShown: (next: boolean) => void;
  variant?: ToggleVariant;
  className?: string;
}) {
  const size: ToggleSize = variant === "list" ? "md" : "sm";
  return (
    <div
      className={`flex flex-col ${variant === "list" ? "gap-2" : "gap-1.5"} ${className}`}
    >
      <FeaturedStarToggle
        leagueName={leagueName}
        isFeatured={isFeatured}
        onChange={onSetFeatured}
        size={size}
        variant={variant}
      />
      <ShownEyeToggle
        leagueName={leagueName}
        isShown={isShown}
        onChange={onToggleShown}
        size={size}
        variant={variant}
      />
    </div>
  );
}

/* ---------- primitive ---------- */

function CircleSwitch({
  checked,
  onChange,
  variant,
  dims,
  tone,
  visibleLabel,
  ariaLabel,
  title,
  icon,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  variant: ToggleVariant;
  dims: (typeof SIZE)[ToggleSize];
  tone: string;
  visibleLabel: string;
  ariaLabel: string;
  title: string;
  icon: React.ReactNode;
}) {
  const button = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      title={title}
      onClick={(event) => {
        // These sit inside rows that are themselves links, or inside a card that
        // opens a sheet. Neither should fire when the press was meant for this.
        event.preventDefault();
        event.stopPropagation();
        onChange(!checked);
      }}
      className={`${BASE} ${dims.button} ${tone}`}
    >
      {icon}
    </button>
  );

  if (variant === "stack") return button;

  return (
    <span className="flex items-center gap-3">
      {button}
      {/* Decorative here: the button's accessible name already opens with these
          same words, so exposing the text again would have it read twice. */}
      <span aria-hidden="true" className="text-sm font-medium text-ink">
        {visibleLabel}
      </span>
    </span>
  );
}
