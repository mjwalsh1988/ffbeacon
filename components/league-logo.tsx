import { Shield } from "lucide-react";
import { ImageWithFallback } from "@/components/image-with-fallback";
import { sleeperAvatarUrl } from "@/lib/sleeper-avatar-url";

/**
 * A Sleeper league's own logo, for every list of leagues on the site.
 *
 * Decorative on purpose. The league name is always adjacent visible text, so
 * an alt of the name would have every row announce it twice; `alt=""` makes
 * `ImageWithFallback` hide the element from assistive tech outright, which is
 * why a league with no logo adds nothing to say rather than a phantom "image".
 *
 * Square-cornered on purpose too. Circles are reserved for people, and a
 * league is not a person.
 *
 * A league with `avatar: null` (most Sleeper leagues never set one) renders
 * the placeholder at the same size, so the column stays aligned down the list
 * instead of collapsing on the rows that have nothing.
 *
 * The avatar id comes from the live Sleeper payload (`SleeperLeague.avatar`)
 * or from `leagues.metadata->>avatar`, which is the same object stored
 * verbatim. There is no avatar column and none is to be added.
 *
 * Not a client component, deliberately. `ImageWithFallback` below already is,
 * and it owns the only state involved (whether the image failed to load), so
 * marking this one too would open a client boundary per row on the server
 * components that render it and pull the icon into the bundle instead of
 * letting it serialize. `components/sleeper-avatar.tsx` is the existing
 * precedent for wrapping that child from the server.
 */
export function LeagueLogo({
  avatarId,
  name,
  size = 48,
  className = "",
}: {
  avatarId: string | null | undefined;
  /** The league name. Used for the title attribute only; the image is decorative. */
  name: string;
  size?: 32 | 40 | 48 | 64;
  className?: string;
}) {
  // The thumbnail is the right asset up to 48 px; the masthead at 64 wants the
  // full one.
  const src = sleeperAvatarUrl(avatarId, size >= 64 ? "full" : "thumb");
  const icon = Math.round(size * 0.5);

  return (
    // The wrapper carries the title so a mouse reader gets the league name on
    // hover without the image gaining an accessible name it does not need.
    <span
      title={name || undefined}
      aria-hidden="true"
      className="inline-flex flex-shrink-0"
    >
      <ImageWithFallback
        src={src}
        alt=""
        size={size}
        radiusClass="rounded-card"
        className={className}
        fallback={
          <Shield
            aria-hidden="true"
            strokeWidth={1.75}
            style={{ width: icon, height: icon }}
          />
        }
      />
    </span>
  );
}
