import { describe, it, expect } from "vitest";
import { serializeJsonLd } from "@/lib/json-ld";

/** FFB-SEC-006: JSON-LD script-breakout escaping. Real behavior test. */
describe("serializeJsonLd", () => {
  it("neutralizes a closing-script breakout in a string value", () => {
    const hostile = {
      "@type": "Article",
      headline: 'Payload </script><script>alert(document.cookie)</script>',
    };
    const out = serializeJsonLd(hostile);
    // The raw sequence that would close the script element must not survive.
    expect(out).not.toContain("</script>");
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    // It is escaped to the JSON unicode form instead.
    expect(out).toContain("\\u003c");
    expect(out).toContain("\\u003e");
  });

  it("escapes ampersands", () => {
    const out = serializeJsonLd({ name: "A & B" });
    expect(out).not.toContain("&");
    expect(out).toContain("\\u0026");
  });

  it("escapes U+2028 and U+2029 line terminators", () => {
    const out = serializeJsonLd({
      note: `line${String.fromCharCode(0x2028)}sep${String.fromCharCode(0x2029)}end`,
    });
    expect(out).not.toContain(String.fromCharCode(0x2028));
    expect(out).not.toContain(String.fromCharCode(0x2029));
    expect(out).toContain("\\u2028");
    expect(out).toContain("\\u2029");
  });

  it("remains valid JSON that round-trips to the original value", () => {
    const original = {
      "@context": "https://schema.org",
      "@type": "Person",
      name: "Michael </script> & <b>friends</b>",
      sameAs: ["https://x.com/a", "https://example.com/?a=1&b=2"],
    };
    const out = serializeJsonLd(original);
    expect(() => JSON.parse(out)).not.toThrow();
    expect(JSON.parse(out)).toEqual(original);
  });

  it("leaves normal structured data intact and parseable", () => {
    const data = { "@context": "https://schema.org", "@type": "BreadcrumbList" };
    expect(JSON.parse(serializeJsonLd(data))).toEqual(data);
  });
});
