import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

/**
 * Web app manifest. Icons are the three square files that already exist
 * under public/img: the 96px mark used as the tab favicon, the 180px Apple
 * touch icon, and the 512px mark (shipped for the email logo but square and
 * full-bleed, so it doubles as the large PWA icon rather than inventing a
 * new export). No maskable purpose is declared: none of these were exported
 * with a maskable safe zone, so claiming one would be a guess.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE.name,
    short_name: SITE.shortName,
    description: SITE.tagline,
    start_url: "/",
    display: "standalone",
    background_color: "#07070D",
    theme_color: "#07070D",
    icons: [
      {
        src: "/img/ff-beacon-mark-96.png",
        sizes: "96x96",
        type: "image/png",
      },
      {
        src: "/img/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
      {
        src: "/img/ff-beacon-logo-email.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
