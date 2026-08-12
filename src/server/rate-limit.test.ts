// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRateLimitDecision,
  createRateLimitKey,
  getTrustedClientAddress,
} from "./rate-limit";

describe("authentication rate-limit helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates stable opaque keys and retry decisions", () => {
    const key = createRateLimitKey("login:email", "user@example.com");
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).not.toContain("user@example.com");
    expect(createRateLimitKey("login:email", "user@example.com")).toBe(key);
    expect(createRateLimitKey("registration:email", "user@example.com")).not.toBe(key);

    const now = new Date("2026-08-11T08:00:00.000Z");
    expect(
      createRateLimitDecision(
        6,
        new Date("2026-08-11T08:00:40.100Z"),
        5,
        now,
        "revision-6",
      ),
    ).toEqual({
      allowed: false,
      attemptCount: 6,
      revision: "revision-6",
      retryAfterSeconds: 41,
    });
  });

  it("uses proxy headers only when explicitly trusted", () => {
    const request = new Request("http://localhost", {
      headers: {
        "x-forwarded-for": "203.0.113.8, 10.0.0.2",
        "x-real-ip": "198.51.100.4",
      },
    });
    expect(getTrustedClientAddress(request)).toBeUndefined();

    vi.stubEnv("TRUST_PROXY_HEADERS", "true");
    expect(getTrustedClientAddress(request)).toBe("203.0.113.8");
    expect(
      getTrustedClientAddress(
        new Request("http://localhost", {
          headers: { "x-forwarded-for": "invalid", "x-real-ip": "2001:db8::1" },
        }),
      ),
    ).toBe("2001:db8::1");
  });
});
