import { describe, expect, it } from "vitest";
import { PASSWORD_MAX_BYTES, passwordByteLength } from "@/lib/users";
import { changePasswordSchema, closeTradeSchema, passwordSchema, tradeSchema } from "@/lib/validation";

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

describe("option trades", () => {
  const stock = { accountId: "acc", symbol: "spy", assetClass: "STOCK", side: "LONG", quantity: "100", entryPrice: "450", entryAt: "2024-09-06T09:30", notes: "" };

  it("requires call/put, a positive strike and an expiration for OPTION trades", () => {
    const missing = tradeSchema.safeParse({ ...stock, assetClass: "OPTION" });
    expect(missing.success).toBe(false);
    const paths = missing.error?.issues.map((i) => i.path.join(".")).sort();
    expect(paths).toEqual(["expiresAt", "optionType", "strikePrice"]);
    const zeroStrike = tradeSchema.safeParse({ ...stock, assetClass: "OPTION", optionType: "CALL", strikePrice: "0", expiresAt: "2024-09-20" });
    expect(zeroStrike.success).toBe(false);
    expect(zeroStrike.error?.issues[0]?.path).toEqual(["strikePrice"]);
    const ok = tradeSchema.safeParse({ ...stock, assetClass: "OPTION", optionType: "PUT", strikePrice: "452.50", expiresAt: "2024-09-20" });
    expect(ok.success).toBe(true);
    expect(ok.data?.strikePrice).toBe("452.5");
    expect(ok.data?.symbol).toBe("SPY");
  });

  it("refuses option fields on other asset classes and ignores blanks", () => {
    const withStrike = tradeSchema.safeParse({ ...stock, strikePrice: "450" });
    expect(withStrike.success).toBe(false);
    expect(withStrike.error?.issues[0]?.path).toEqual(["strikePrice"]);
    expect(tradeSchema.safeParse({ ...stock, optionType: "", strikePrice: "", expiresAt: "" }).success).toBe(true);
  });

  it("validates the close sheet", () => {
    const ok = closeTradeSchema.safeParse({ closeQuantity: "40", exitPrice: "52", exitAt: "2024-09-06T10:00", extraFees: "", exitNote: " Took some off. ", overridden: "" });
    expect(ok.success).toBe(true);
    expect(ok.data).toMatchObject({ closeQuantity: "40", exitPrice: "52", extraFees: undefined, exitNote: "Took some off.", overridden: false });
    expect(closeTradeSchema.safeParse({ closeQuantity: "0", exitPrice: "52", exitAt: "2024-09-06T10:00" }).success).toBe(false);
    expect(closeTradeSchema.safeParse({ closeQuantity: "1", exitPrice: "-1", exitAt: "2024-09-06T10:00" }).success).toBe(false);
    expect(closeTradeSchema.safeParse({ closeQuantity: "1", exitPrice: "0", exitAt: "" }).success).toBe(false);
  });
});
