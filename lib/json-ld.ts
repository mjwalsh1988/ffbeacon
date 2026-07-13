/**
 * Safe JSON-LD serialization for injection into an inline
 * `<script type="application/ld+json">` block (FFB-SEC-006).
 *
 * Plain `JSON.stringify` escapes quotes and backslashes but NOT the characters that
 * matter inside an HTML script element: `<`, `>`, and `&`. A value containing the
 * sequence `</script>` would therefore terminate the script element and allow an
 * injected `<script>` to execute. Because our JSON-LD interpolates externally
 * influenced values (AI-generated Beacon Brief titles, Sleeper-sourced player fields),
 * every emitter MUST route through this helper instead of `JSON.stringify`.
 *
 * The escaped characters only ever appear inside JSON string values (never in JSON
 * structural syntax), so replacing them with their `\uXXXX` escapes keeps the output
 * valid JSON and valid JSON-LD while making it impossible to break out of the script
 * element. U+2028 / U+2029 are also escaped: they are legal in JSON strings but are
 * line terminators in HTML/JS parsing contexts.
 */

// Built from string escapes so the source stays pure ASCII.
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

const SCRIPT_BREAKOUT = new RegExp("[<>&\\u2028\\u2029]", "g");

const ESCAPES: Record<string, string> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  [LINE_SEPARATOR]: "\\u2028",
  [PARAGRAPH_SEPARATOR]: "\\u2029",
};

/**
 * Serialize a JSON-LD object to a string that is safe to place inside a
 * `dangerouslySetInnerHTML` script body. Returns valid JSON.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(SCRIPT_BREAKOUT, (c) => ESCAPES[c]);
}
