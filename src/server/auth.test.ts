// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookieStore: {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  },
  repository: {
    createAccount: vi.fn(),
    findUserByEmail: vi.fn(),
    createSession: vi.fn(),
    getSession: vi.fn(),
    deleteSession: vi.fn(),
    consumeRateLimit: vi.fn(),
    clearRateLimit: vi.fn(),
  },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => mocks.cookieStore),
}));

vi.mock("./database", () => ({
  getRepository: vi.fn(() => mocks.repository),
}));

import {
  getCurrentSession,
  hashSessionToken,
  loginAccount,
  logoutCurrentSession,
  registerAccount,
  requireCurrentSession,
  SESSION_COOKIE_NAME,
  setSessionCookie,
} from "./auth";
import {
  AuthenticationError,
  DuplicateAccountError,
  InvalidCredentialsError,
  RateLimitExceededError,
} from "./errors";
import { hashPassword } from "./password";
import { RepositoryConflictError } from "./repository";

const identity = {
  user: { id: "user-1", email: "user@example.com", displayName: "林岚" },
  workspaceId: "workspace-1",
};

describe("authentication service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.repository.consumeRateLimit.mockResolvedValue({
      allowed: true,
      attemptCount: 1,
      revision: "revision-1",
      retryAfterSeconds: 0,
    });
    mocks.repository.createSession.mockResolvedValue(undefined);
    mocks.repository.clearRateLimit.mockResolvedValue(undefined);
    mocks.repository.deleteSession.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("registers with a password hash and stores only a session token hash", async () => {
    mocks.repository.createAccount.mockReturnValue(identity);

    const result = await registerAccount({
      email: identity.user.email,
      displayName: identity.user.displayName,
      password: "secure-pass-2026",
    });

    expect(mocks.repository.createAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        email: identity.user.email,
        passwordHash: expect.stringMatching(/^scrypt\$/),
      }),
    );
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mocks.repository.createSession).toHaveBeenCalledWith(
      identity,
      hashSessionToken(result.token),
      result.expiresAt,
      expect.any(Date),
    );
    expect(JSON.stringify(mocks.repository.createSession.mock.calls)).not.toContain(
      result.token,
    );
  });

  it("maps duplicate registration and invalid login to account-safe errors", async () => {
    mocks.repository.createAccount.mockImplementation(() => {
      throw new RepositoryConflictError("duplicate row");
    });
    await expect(
      registerAccount({
        email: identity.user.email,
        displayName: identity.user.displayName,
        password: "secure-pass-2026",
      }),
    ).rejects.toBeInstanceOf(DuplicateAccountError);

    mocks.repository.findUserByEmail.mockReturnValue(null);
    await expect(
      loginAccount({ email: "missing@example.com", password: "secure-pass-2026" }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it("verifies credentials before issuing a fresh session", async () => {
    const passwordHash = await hashPassword("secure-pass-2026");
    mocks.repository.findUserByEmail.mockReturnValue({ ...identity, passwordHash });

    const result = await loginAccount({
      email: identity.user.email,
      password: "secure-pass-2026",
    });
    expect(result.identity).toEqual(identity);
    expect(mocks.repository.createSession).toHaveBeenCalledOnce();
    expect(mocks.repository.clearRateLimit).toHaveBeenCalledWith(
      expect.stringMatching(/^[a-f0-9]{64}$/),
      "revision-1",
    );

    await expect(
      loginAccount({ email: identity.user.email, password: "wrong-pass-2026" }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it("blocks excessive attempts before account lookup or password hashing", async () => {
    mocks.repository.consumeRateLimit.mockResolvedValueOnce({
      allowed: false,
      attemptCount: 6,
      revision: "revision-6",
      retryAfterSeconds: 321,
    });

    const error = await loginAccount(
      { email: identity.user.email, password: "wrong-pass-2026" },
      { clientAddress: "203.0.113.8" },
    ).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(RateLimitExceededError);
    expect(error).toMatchObject({ retryAfterSeconds: 321 });
    expect(mocks.repository.findUserByEmail).not.toHaveBeenCalled();
    expect(mocks.repository.createAccount).not.toHaveBeenCalled();
  });

  it("supports an emergency rate-limit rollback flag", async () => {
    vi.stubEnv("AUTH_RATE_LIMIT_ENABLED", "false");
    mocks.repository.findUserByEmail.mockReturnValue(null);

    await expect(
      loginAccount({ email: identity.user.email, password: "wrong-pass-2026" }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(mocks.repository.consumeRateLimit).not.toHaveBeenCalled();
  });

  it("does not create a session if the successful-login bucket cannot be cleared", async () => {
    const passwordHash = await hashPassword("secure-pass-2026");
    mocks.repository.findUserByEmail.mockReturnValue({ ...identity, passwordHash });
    mocks.repository.clearRateLimit.mockRejectedValue(new Error("clear failed"));

    await expect(
      loginAccount({ email: identity.user.email, password: "secure-pass-2026" }),
    ).rejects.toThrow("clear failed");
    expect(mocks.repository.createSession).not.toHaveBeenCalled();
  });

  it("sets secure cookie attributes and resolves the database session", async () => {
    const expiresAt = new Date("2026-09-10T08:00:00.000Z");
    await setSessionCookie("raw-token", expiresAt);
    expect(mocks.cookieStore.set).toHaveBeenCalledWith(
      SESSION_COOKIE_NAME,
      "raw-token",
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        expires: expiresAt,
        path: "/",
      }),
    );

    mocks.cookieStore.get.mockReturnValue({ value: "raw-token" });
    mocks.repository.getSession.mockReturnValue({
      ...identity,
      expiresAt: expiresAt.toISOString(),
    });
    await expect(getCurrentSession()).resolves.toMatchObject(identity);
    expect(mocks.repository.getSession).toHaveBeenCalledWith(
      hashSessionToken("raw-token"),
    );
  });

  it("fails closed without a session and revokes the current session on logout", async () => {
    mocks.cookieStore.get.mockReturnValueOnce(undefined);
    await expect(requireCurrentSession()).rejects.toBeInstanceOf(AuthenticationError);

    mocks.cookieStore.get.mockReturnValueOnce({ value: "raw-token" });
    await logoutCurrentSession();
    expect(mocks.repository.deleteSession).toHaveBeenCalledWith(
      hashSessionToken("raw-token"),
    );
    expect(mocks.cookieStore.delete).toHaveBeenCalledWith(SESSION_COOKIE_NAME);
  });
});
