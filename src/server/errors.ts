export class AuthenticationError extends Error {}
export class AuthorizationError extends Error {}
export class InvalidCredentialsError extends Error {}
export class DuplicateAccountError extends Error {}
export class RateLimitExceededError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Authentication rate limit exceeded");
  }
}
