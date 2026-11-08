/**
 * The Long Shot mark (plan 18A.4): a goal post, a kick's flight arc in the
 * beacon gradient (dashed for the first stretch, solid near the ball), the
 * ball, and the kick spot. Drawn in code.
 *
 * Decorative (aria-hidden) wherever the name is adjacent text; pass
 * `standalone` where it stands alone and it becomes role="img" named
 * "Long Shot". `gradientId` must be unique per instance on a page.
 */

export function LongShotMark({
  size = 28,
  standalone = false,
  gradientId = "ls-mark-beacon",
  className = "",
}: {
  size?: number;
  standalone?: boolean;
  gradientId?: string;
  className?: string;
}) {
  const a11y = standalone ? { role: "img" as const, "aria-label": "Long Shot" } : { "aria-hidden": true as const };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      focusable="false"
      {...a11y}
    >
      <defs>
        <linearGradient id={gradientId} x1="4" y1="40" x2="40" y2="18" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#A855F7" />
          <stop offset="1" stopColor="#22D3EE" />
        </linearGradient>
      </defs>
      <g stroke="#F4F4F8" strokeWidth="2.2" strokeLinecap="round" opacity="0.9">
        <line x1="38" y1="10" x2="38" y2="30" />
        <line x1="44" y1="10" x2="44" y2="30" />
        <line x1="36" y1="30" x2="46" y2="30" />
      </g>
      {/* M 4 40 Q 22 -6 40 18, split at t = 0.4: the first part dashed, the rest solid. */}
      <path d="M 4 40 Q 11.2 21.6 18.4 14.4" stroke={`url(#${gradientId})`} strokeWidth="2.6" strokeLinecap="round" strokeDasharray="3 4" />
      <path d="M 18.4 14.4 Q 29.2 3.6 40 18" stroke={`url(#${gradientId})`} strokeWidth="2.6" strokeLinecap="round" />
      <ellipse cx="40" cy="18" rx="5.2" ry="3.4" transform="rotate(35 40 18)" fill="#22D3EE" />
      <path d="M 37.6 17.2 L 42.4 18.8" stroke="#07070D" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="4" cy="40" r="2.4" fill="#A855F7" />
    </svg>
  );
}
