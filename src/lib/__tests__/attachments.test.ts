import { describe, expect, it } from "vitest";
import { attachmentQuotaBytes, DEFAULT_ATTACHMENT_QUOTA_MB, formatMegabytes, safeFilename, storageVerdict } from "@/lib/attachments";

const MB = 1024 * 1024;

describe("safe file names", () => {
  it("keeps the last path segment with header-safe characters only", () => {
    expect(safeFilename("Screenshot 2026-09-18 (1).png")).toBe("Screenshot 2026-09-18 (1).png");
    expect(safeFilename("C:\\Users\\me\\shot.png")).toBe("shot.png");
    expect(safeFilename("../../etc/passwd")).toBe("passwd");
  });

  it("replaces anything outside Latin-1 or risky for a header, so the response can always be built", () => {
    expect(safeFilename("スクリーンショット.png")).toBe("_________.png"); // nine characters, nine placeholders
    expect(safeFilename('quote"and\r\nnewline.png')).toBe("quote_and__newline.png");
    expect(() => new Response("", { headers: { "Content-Disposition": `inline; filename="${safeFilename("écran 📱.png")}"` } })).not.toThrow();
  });

  it("never returns an empty name and caps the length", () => {
    expect(safeFilename("")).toBe("screenshot");
    expect(safeFilename(undefined, "shared-screenshot")).toBe("shared-screenshot");
    expect(safeFilename("/")).toBe("screenshot");
    expect(safeFilename("a".repeat(500))).toHaveLength(200);
  });
});

describe("attachment quota", () => {
  it("reads ATTACHMENT_QUOTA_MB and falls back to 200 MB", () => {
    expect(attachmentQuotaBytes("50")).toBe(50 * MB);
    expect(attachmentQuotaBytes("0.5")).toBe(0.5 * MB);
    expect(attachmentQuotaBytes(undefined)).toBe(DEFAULT_ATTACHMENT_QUOTA_MB * MB);
    for (const bad of ["", "  ", "0", "-5", "lots", "NaN"]) expect(attachmentQuotaBytes(bad), bad).toBe(DEFAULT_ATTACHMENT_QUOTA_MB * MB);
  });

  it("accepts an upload that fits and refuses one that does not, with the figures", () => {
    expect(storageVerdict(199 * MB, 1 * MB, 200 * MB).ok).toBe(true);
    const refused = storageVerdict(199.5 * MB, 1 * MB, 200 * MB);
    expect(refused.ok).toBe(false);
    expect(refused.message).toContain("199.5 MB of 200 MB");
    expect(refused.message).toMatch(/Delete some screenshots/);
    expect(storageVerdict(0, 201 * MB, 200 * MB).ok).toBe(false);
  });

  it("formats megabytes readably", () => {
    expect(formatMegabytes(200 * MB)).toBe("200 MB");
    expect(formatMegabytes(2.25 * MB)).toBe("2.3 MB");
    expect(formatMegabytes(0)).toBe("0 MB");
  });
});
