import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const hash = await hashPassword("Quote@2611");
    expect(hash.startsWith("scrypt$16384$8$1$")).toBe(true);
    expect(await verifyPassword("Quote@2611", hash)).toBe(true);
    expect(await verifyPassword("quote@2611", hash)).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("rejects malformed stored hashes instead of throwing", async () => {
    expect(await verifyPassword("x", "plaintext")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$a$b$c$d$e")).toBe(false);
  });
});
