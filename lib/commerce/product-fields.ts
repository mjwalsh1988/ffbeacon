/**
 * The product editor's pure helpers, apart from lib/commerce/products.ts so the
 * client form does not pull the donation parser and the database reads with it.
 */

import type { ProductPlacement } from "./types";

export const PRODUCT_PLACEMENTS: ProductPlacement[] = [
  "blueprint",
  "league-overview",
  "my-beacon",
];

/**
 * One text box, one feature per line. Trims each line and drops the blanks, so a
 * trailing newline in the textarea does not become an empty feature.
 */
export function featuresFromLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function linesFromFeatures(features: string[]): string {
  return features.join("\n");
}
