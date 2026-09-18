import { describe, expect, it } from "vitest";
import {
  accountChangeError,
  generateTemporaryPassword,
  isValidUsername,
  normalizeUsername,
  usernameError,
  usernameFromEmail,
} from "../users";

describe("usernames", () => {
  it("accepts letters, digits, dot, underscore and hyphen between 3 and 32 characters", () => {
    for (const ok of ["abc", "trader_1", "a.b-c", "x".repeat(32), "ABC"]) expect(isValidUsername(ok), ok).toBe(true);
    for (const bad of ["ab", "", "x".repeat(33), "has space", "ünïcode", "semi;colon", "at@sign"]) expect(isValidUsername(bad), bad).toBe(false);
  });

  it("normalises case and surrounding whitespace", () => {
    expect(normalizeUsername("  Owner ")).toBe("owner");
    expect(usernameError(" OwNeR ")).toBeNull();
  });

  it("explains a refusal", () => {
    expect(usernameError("ab")).toMatch(/3 to 32/);
    expect(usernameError("bad name")).toMatch(/letters, digits/);
  });

  it("derives a username from an email like the migration does", () => {
    expect(usernameFromEmail("Jane.Doe+x@example.com", "cid")).toBe("jane.doex");
    expect(usernameFromEmail("ab@example.com", "cmfx1234abcd")).toBe("user-cmfx1234");
    expect(usernameFromEmail("a".repeat(40) + "@x.io", "cid")).toHaveLength(32);
    expect(isValidUsername(usernameFromEmail("@@@", "cid"))).toBe(true);
  });
});

describe("temporary passwords", () => {
  it("draws from the readable alphabet at the requested length", () => {
    const pw = generateTemporaryPassword(14);
    expect(pw).toHaveLength(14);
    expect(pw).toMatch(/^[a-km-zA-HJ-NP-Z2-9]+$/);
    expect(generateTemporaryPassword()).not.toBe(generateTemporaryPassword());
  });

  it("uses rejection sampling so every alphabet character is reachable and none beyond it", () => {
    const seq = Array.from({ length: 300 }, (_, i) => i % 256);
    let cursor = 0;
    const random = (n: number) => new Uint8Array(seq.slice(cursor, (cursor += n)));
    const pw = generateTemporaryPassword(20, random);
    expect(pw).toHaveLength(20);
    expect(pw.startsWith("abcdefghijkmnpqrstuv")).toBe(true);
  });

  it("refuses absurd lengths", () => {
    expect(() => generateTemporaryPassword(4)).toThrow();
    expect(() => generateTemporaryPassword(100)).toThrow();
  });
});

describe("last admin rule", () => {
  const admin = { id: "a1", role: "ADMIN" as const, isActive: true };
  const otherAdmin = { id: "a2", role: "ADMIN" as const, isActive: true };
  const user = { id: "u1", role: "USER" as const, isActive: true };

  it("never lets an admin act on their own account", () => {
    for (const change of ["deactivate", "demote", "delete"] as const) {
      expect(accountChangeError(change, { actorId: "a1", target: admin, activeAdminCount: 3 })).toMatch(/your own account/);
    }
  });

  it("keeps the last active admin", () => {
    expect(accountChangeError("delete", { actorId: "x", target: admin, activeAdminCount: 1 })).toMatch(/last active admin/);
    expect(accountChangeError("deactivate", { actorId: "x", target: admin, activeAdminCount: 1 })).toMatch(/last active admin/);
    expect(accountChangeError("demote", { actorId: "x", target: admin, activeAdminCount: 1 })).toMatch(/last active admin/);
  });

  it("allows changes when another active admin remains", () => {
    expect(accountChangeError("delete", { actorId: "a1", target: otherAdmin, activeAdminCount: 2 })).toBeNull();
    expect(accountChangeError("demote", { actorId: "a1", target: otherAdmin, activeAdminCount: 2 })).toBeNull();
  });

  it("does not count an inactive admin as protection", () => {
    const inactiveAdmin = { id: "a3", role: "ADMIN" as const, isActive: false };
    expect(accountChangeError("delete", { actorId: "a1", target: inactiveAdmin, activeAdminCount: 1 })).toBeNull();
  });

  it("always allows changes to plain users by someone else", () => {
    expect(accountChangeError("deactivate", { actorId: "a1", target: user, activeAdminCount: 1 })).toBeNull();
    expect(accountChangeError("delete", { actorId: "a1", target: user, activeAdminCount: 1 })).toBeNull();
  });
});
