/**
 * Shared helpers for the Signal custom-reaction catalog. Isomorphic (no server-only
 * imports) so both the admin manager and the public picker can use them.
 *
 * A reaction type is one of two kinds:
 *   - 'text'  : a short Unicode glyph in `char` (e.g. an emoji).
 *   - 'image' : a small static WebP in the signal-reaction-emojis bucket,
 *               referenced by `image_path`.
 * `label` is the required accessible name for either kind.
 */

export const REACTION_BUCKET = "signal-reaction-emojis";

export const REACTION_SLUG_MAX = 40;
export const REACTION_LABEL_MAX = 60;
export const REACTION_CHAR_MAX = 32;

export type ReactionKind = "text" | "image";

export type ReactionType = {
  id: string;
  slug: string;
  label: string;
  kind: ReactionKind;
  char: string | null;
  image_path: string | null;
  display_order: number;
  is_active: boolean;
};

/**
 * Public URL for an image reaction's stored object. The bucket is public, so the
 * object URL resolves without a signed token.
 */
export function reactionImageUrl(imagePath: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return `${base}/storage/v1/object/public/${REACTION_BUCKET}/${imagePath}`;
}

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// The admin upload route always returns "reactions/<uuid>.webp"; the catalog
// write paths only accept image paths in that exact shape (a strict UUID v4
// filename), so a reaction can never point at an arbitrary storage object.
const IMAGE_PATH_RE =
  /^reactions\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;

export type ReactionTypeInput = {
  slug: string;
  label: string;
  kind: ReactionKind;
  char?: string | null;
  image_path?: string | null;
};

export type ReactionValidation =
  | { ok: true; value: Required<Pick<ReactionTypeInput, "slug" | "label" | "kind">> & {
      char: string | null;
      image_path: string | null;
    } }
  | { ok: false; error: string };

/**
 * Validate a catalog write. Mirrors the DB constraints (slug shape + length,
 * label length, kind, exactly-one payload matching kind) so the admin form gets a
 * friendly message; the DB CHECKs remain the authoritative backstop.
 */
export function validateReactionType(input: ReactionTypeInput): ReactionValidation {
  const slug = (input.slug ?? "").trim().toLowerCase();
  if (slug.length < 1 || slug.length > REACTION_SLUG_MAX || !SLUG_RE.test(slug)) {
    return {
      ok: false,
      error: "Slug must be lowercase letters, numbers, and hyphens (1 to 40 characters).",
    };
  }

  const label = (input.label ?? "").trim();
  if (label.length < 1 || label.length > REACTION_LABEL_MAX) {
    return { ok: false, error: "Label is required (1 to 60 characters)." };
  }

  if (input.kind !== "text" && input.kind !== "image") {
    return { ok: false, error: "Choose a reaction kind." };
  }

  if (input.kind === "text") {
    const char = (input.char ?? "").trim();
    if (char.length < 1 || char.length > REACTION_CHAR_MAX) {
      return { ok: false, error: "Enter an emoji or short text (1 to 32 characters)." };
    }
    return { ok: true, value: { slug, label, kind: "text", char, image_path: null } };
  }

  const imagePath = (input.image_path ?? "").trim();
  if (!IMAGE_PATH_RE.test(imagePath)) {
    return { ok: false, error: "Upload an image for this reaction first." };
  }
  return { ok: true, value: { slug, label, kind: "image", char: null, image_path: imagePath } };
}
