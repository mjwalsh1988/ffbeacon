import { describe, expect, it, vi } from "vitest";
import {
  attachmentAllowed,
  attachmentPath,
  beginAttachment,
  finalizeAttachment,
  objectInListing,
  sanitizeFileName,
} from "./deliverables";

describe("sanitizeFileName", () => {
  it("keeps a clean name", () => {
    expect(sanitizeFileName("owls-trade-targets.pdf")).toBe("owls-trade-targets.pdf");
  });

  it("replaces everything outside the safe set", () => {
    expect(sanitizeFileName("My Team (v2)!.pdf")).toBe("My-Team--v2--.pdf");
  });

  it("drops any path a browser sent along", () => {
    expect(sanitizeFileName("C:\\Users\\me\\review.pdf")).toBe("review.pdf");
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
  });

  it("cannot be walked up a directory or hidden", () => {
    expect(sanitizeFileName("..")).toBe("file");
    expect(sanitizeFileName(".env")).toBe("env");
    expect(sanitizeFileName("a..b.pdf")).toBe("a.b.pdf");
  });

  it("falls back when nothing survives", () => {
    expect(sanitizeFileName("")).toBe("file");
  });

  it("caps the length and keeps the extension", () => {
    const name = sanitizeFileName(`${"x".repeat(200)}.pdf`);
    expect(name).toHaveLength(100);
    expect(name.endsWith(".pdf")).toBe(true);
  });
});

describe("the path shape", () => {
  it("nests the object under the order and the row", () => {
    expect(attachmentPath("o1", "d1", "a.pdf")).toBe("orders/o1/d1/a.pdf");
  });
});

describe("attachmentAllowed", () => {
  it("takes the bucket's types up to 10 MB", () => {
    expect(attachmentAllowed("application/pdf", 10_485_760)).toBe(true);
    expect(attachmentAllowed("application/pdf", 10_485_761)).toBe(false);
    expect(attachmentAllowed("application/pdf", 0)).toBe(false);
    expect(attachmentAllowed("application/zip", 100)).toBe(false);
  });
});

describe("objectInListing", () => {
  it("finds the object and reads its real size", () => {
    expect(
      objectInListing([{ name: "a.pdf", metadata: { size: 123 } }], "orders/o/d/a.pdf"),
    ).toEqual({ size: 123 });
  });

  it("is null when the upload never arrived", () => {
    expect(objectInListing([], "orders/o/d/a.pdf")).toBeNull();
  });
});

function fakeAdmin() {
  const insert = vi.fn(async () => ({ error: null }));
  const update = vi.fn(() => ({ eq: async () => ({ error: null }) }));
  const createSignedUploadUrl = vi.fn(async () => ({ data: { token: "tok" }, error: null }));
  const list = vi.fn(async () => ({ data: [], error: null }));
  const admin = {
    from: () => ({ insert, update }),
    storage: { from: () => ({ createSignedUploadUrl, list }) },
  };
  return { admin, insert, update, createSignedUploadUrl, list };
}

describe("beginAttachment", () => {
  it("refuses a disallowed file before any row or token exists", async () => {
    const fake = fakeAdmin();
    const result = await beginAttachment(fake.admin as never, {
      orderId: "o1",
      fileName: "a.zip",
      mimeType: "application/zip",
      size: 10,
    });
    expect(result.ok).toBe(false);
    expect(fake.insert).not.toHaveBeenCalled();
    expect(fake.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("writes the pending row BEFORE minting the token, for the same path", async () => {
    const fake = fakeAdmin();
    const order: string[] = [];
    fake.insert.mockImplementation(async () => {
      order.push("row");
      return { error: null };
    });
    fake.createSignedUploadUrl.mockImplementation(async () => {
      order.push("token");
      return { data: { token: "tok" }, error: null };
    });
    const result = await beginAttachment(fake.admin as never, {
      orderId: "o1",
      fileName: "my review.pdf",
      mimeType: "application/pdf",
      size: 10,
    });
    expect(order).toEqual(["row", "token"]);
    expect(result).toMatchObject({ ok: true, token: "tok" });
    const row = (fake.insert.mock.calls[0] as unknown as [{ storage_path: string; upload_state: string }])[0];
    expect(row.upload_state).toBe("pending");
    expect(row.storage_path).toMatch(/^orders\/o1\/[0-9a-f-]{36}\/my-review\.pdf$/);
    expect(fake.createSignedUploadUrl.mock.calls[0]).toContain(row.storage_path);
  });
});

describe("finalizeAttachment", () => {
  it("leaves the row pending when the object is not there", async () => {
    const fake = fakeAdmin();
    const result = await finalizeAttachment(fake.admin as never, {
      id: "d1",
      storage_path: "orders/o/d1/a.pdf",
    });
    expect(result).toEqual({ ok: false, error: "The upload did not finish. Try again." });
    expect(fake.update).not.toHaveBeenCalled();
  });

  it("writes the listing's real size and marks it ready", async () => {
    const fake = fakeAdmin();
    fake.list.mockImplementation(
      async () =>
        ({ data: [{ name: "a.pdf", metadata: { size: 777 } }], error: null }) as never,
    );
    const result = await finalizeAttachment(fake.admin as never, {
      id: "d1",
      storage_path: "orders/o/d1/a.pdf",
    });
    expect(result).toEqual({ ok: true });
    expect(fake.update.mock.calls[0]).toEqual([{ file_size: 777, upload_state: "ready" }]);
  });
});
