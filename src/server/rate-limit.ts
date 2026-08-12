import { createHash } from "node:crypto";
import { isIP } from "node:net";

export interface RateLimitPolicy {
  limit: number;
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  attemptCount: number;
  revision: string;
  retryAfterSeconds: number;
}

export const authRateLimitPolicies = {
  loginEmail: { limit: 5, windowMs: 15 * 60 * 1000 },
  loginClient: { limit: 30, windowMs: 15 * 60 * 1000 },
  registrationEmail: { limit: 3, windowMs: 60 * 60 * 1000 },
  registrationClient: { limit: 10, windowMs: 60 * 60 * 1000 },
} satisfies Record<string, RateLimitPolicy>;

export function createRateLimitKey(scope: string, identifier: string) {
  return createHash("sha256")
    .update(`${scope}\0${identifier}`)
    .digest("hex");
}

export function createRateLimitDecision(
  attemptCount: number,
  expiresAt: Date,
  limit: number,
  now: Date,
  revision: string,
): RateLimitDecision {
  return {
    allowed: attemptCount <= limit,
    attemptCount,
    revision,
    retryAfterSeconds:
      attemptCount <= limit
        ? 0
        : Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000)),
  };
}

export function getTrustedClientAddress(request: Request) {
  if (process.env.TRUST_PROXY_HEADERS !== "true") return undefined;

  const forwardedAddress = request.headers
    .get("x-forwarded-for")
    ?.split(",", 1)[0]
    ?.trim();
  if (forwardedAddress && isIP(forwardedAddress)) return forwardedAddress;

  const realAddress = request.headers.get("x-real-ip")?.trim();
  return realAddress && isIP(realAddress) ? realAddress : undefined;
}
