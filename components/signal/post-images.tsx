import type { WallImage } from "@/lib/signal-wall";

/**
 * Render a post's images (1 to 4) in a responsive grid. Each image carries the
 * creator-provided alt text, which is required at upload time, so the gallery is
 * fully described for screen readers. A single image spans the row; two or more
 * use a two-column grid. We render plain <img> (not next/image) because these are
 * already re-encoded, dimension-bounded WebP files served from public storage.
 */
export function PostImages({ images }: { images: WallImage[] }) {
  if (images.length === 0) return null;

  return (
    <ul
      role="list"
      className={`mt-3 grid gap-2 ${images.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}
    >
      {images.map((image, index) => (
        <li
          key={index}
          className="overflow-hidden rounded-card border border-line bg-base"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.url}
            alt={image.alt}
            width={image.width}
            height={image.height}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        </li>
      ))}
    </ul>
  );
}
