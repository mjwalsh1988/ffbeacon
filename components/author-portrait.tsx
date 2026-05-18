/**
 * Portrait of the site's founder, wrapped in a circular FF Beacon brand
 * ring (purple → cyan gradient with a soft outer glow). Used in /about and
 * /author/michael so the byline has a face attached.
 *
 * Defaults to a 160px square, large enough to read on a hero but small
 * enough to inline without dominating. Pass `size` to override.
 */
export function AuthorPortrait({
  size = 160,
  alt = "Michael, founder of FF Beacon",
  className = "",
}: {
  size?: number;
  alt?: string;
  className?: string;
}) {
  return (
    <div
      className={`flex-shrink-0 rounded-full p-[3px] ${className}`}
      style={{
        width: size,
        height: size,
        backgroundImage: "linear-gradient(135deg, #A855F7 0%, #22D3EE 100%)",
        // Twin halo: warm purple bleed top-left, cool cyan bleed bottom-right.
        boxShadow:
          "0 0 36px -12px rgba(168, 85, 247, 0.45), 0 0 48px -16px rgba(34, 211, 238, 0.35)",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/img/author/michael-ff-beacon-founder.jpg"
        alt={alt}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        className="block h-full w-full rounded-full bg-base object-cover"
      />
    </div>
  );
}
