import { HeroLavaLamp, type HeroCopyZone } from "@/components/hero-lava-lamp";

/**
 * Drop-in lava lamp backdrop for any hero on the site.
 *
 * A server component whose only job is to mint the seed, so pages do not have
 * to thread one down themselves. Seeding here rather than inside the backdrop
 * is deliberate: the backdrop is a client component, and if it rolled its own
 * randomness at render time the server HTML and the client's first render would
 * disagree, producing a hydration error and a visible re-shuffle. A seed passed
 * as a prop travels through the flight payload, so both sides build the exact
 * same field.
 *
 * On a dynamic page this re-rolls per request and every visit looks different.
 * On a statically rendered page the seed is fixed at build time, so that hero
 * keeps one arrangement until the next deploy. Both are fine; the motion and
 * color drift run either way.
 *
 * `copy` tells the field where this page's hero text sits so it can keep its
 * bright cores away from it. See HeroCopyZone in hero-lava-lamp.tsx. Getting it
 * wrong is a contrast bug, not a cosmetic one, so pick it from the hero's actual
 * layout rather than by eye:
 *   - `left`   headline and body pinned left in a wide container
 *   - `center` text block inboard of both edges (narrow `max-w-5xl` heroes)
 *   - `wide`   content spanning the full width
 */
export function HeroLavaField({ copy = "left" }: { copy?: HeroCopyZone }) {
  return (
    <HeroLavaLamp seed={Math.floor(Math.random() * 0x7fffffff)} copy={copy} />
  );
}
