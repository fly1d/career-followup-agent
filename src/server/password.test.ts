// @vitest-environment node

import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("uses a salted scrypt hash and verifies only the original password", async () => {
    const first = await hashPassword("reliable-pass-2026");
    const second = await hashPassword("reliable-pass-2026");

    expect(first).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(first).not.toBe(second);
    await expect(verifyPassword("reliable-pass-2026", first)).resolves.toBe(true);
    await expect(verifyPassword("wrong-pass-2026", first)).resolves.toBe(false);
  });

  it("rejects malformed or unsupported hashes", async () => {
    await expect(verifyPassword("password", "not-a-password-hash")).resolves.toBe(
      false,
    );
    await expect(
      verifyPassword(
        "password",
        "scrypt$1$8$1$c2FsdA==$aW52YWxpZA==",
      ),
    ).resolves.toBe(false);
  });
});
