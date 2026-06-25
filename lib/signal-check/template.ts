/**
 * Tiny, safe placeholder substitution for admin-authored explanation
 * templates. Replaces {key} tokens with provided values rendered as plain
 * strings. This is NOT a template engine: no expressions, no logic, no code
 * execution. Unknown tokens are left as-is so a typo is visible rather than
 * silently blanked. Output is later rendered as text (React-escaped).
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      return String(vars[key]);
    }
    return whole;
  });
}
