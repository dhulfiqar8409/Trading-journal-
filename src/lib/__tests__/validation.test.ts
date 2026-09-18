import { describe, expect, it } from "vitest";
import { PASSWORD_MAX_BYTES, passwordByteLength } from "@/lib/users";
import { changePasswordSchema, passwordSchema } from "@/lib/validation";

describe("passwords", () => {
  it("measures the length the hash sees, in UTF-8 bytes", () => {
    expect(passwordByteLength("abcdefghij")).toBe(10);
    expect(passwordByteLength("pässwörd")).toBe(10); // two accented letters take two bytes each
    expect(passwordByteLength("😀".repeat(4))).toBe(16);
  });

  it("needs ten characters and refuses more than 72 bytes with an explanation", () => {
    expect(passwordSchema.safeParse("short").success).toBe(false);
    expect(passwordSchema.safeParse("a".repeat(10)).success).toBe(true);
    expect(passwordSchema.safeParse("a".repeat(PASSWORD_MAX_BYTES)).success).toBe(true);
    const tooLong = passwordSchema.safeParse("a".repeat(PASSWORD_MAX_BYTES + 1));
    expect(tooLong.success).toBe(false);
    expect(tooLong.error?.issues[0]?.message).toMatch(/72 bytes/);
    // 36 emoji are 36 characters but 144 bytes.
    const emoji = passwordSchema.safeParse("😀".repeat(36));
    expect(emoji.success).toBe(false);
    expect(emoji.error?.issues[0]?.message).toMatch(/emoji/);
  });

  it("applies the same limit to a new password", () => {
    const result = changePasswordSchema.safeParse({ currentPassword: "old-password", newPassword: "b".repeat(80), confirmPassword: "b".repeat(80) });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path.join(".") === "newPassword" && /72 bytes/.test(i.message))).toBe(true);
  });
});
