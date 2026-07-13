import { describe, it, expect } from "vitest";
import { readCapped } from "@/lib/sleeper";

/** FFB-SEC-020: Sleeper response-size guard. Tests the streaming byte cap directly. */
function streamResponse(text: string, contentLength?: string): Response {
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const headers = new Headers();
  if (contentLength !== undefined) headers.set("content-length", contentLength);
  return new Response(stream, { headers });
}

describe("readCapped", () => {
  it("returns the body when under the cap (normal response)", async () => {
    expect(await readCapped(streamResponse('{"ok":true}'), 1024)).toBe('{"ok":true}');
  });

  it("returns null when the streamed body exceeds the cap (missing content-length)", async () => {
    const big = "x".repeat(5000);
    expect(await readCapped(streamResponse(big), 1024)).toBeNull();
  });

  it("enforces the cap by actual bytes even when content-length lies (too small)", async () => {
    const big = "x".repeat(5000);
    // Server under-reports the length; the streamed byte count must still trip the cap.
    expect(await readCapped(streamResponse(big, "10"), 1024)).toBeNull();
  });

  it("returns exact bytes up to the cap boundary", async () => {
    const text = "y".repeat(1024);
    expect(await readCapped(streamResponse(text), 1024)).toBe(text);
  });
});
