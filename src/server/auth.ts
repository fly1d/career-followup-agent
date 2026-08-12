import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getRepository } from "./database";
import {
  AuthenticationError,
  DuplicateAccountError,
  InvalidCredentialsError,
  RateLimitExceededError,
} from "./errors";
import { consumeLoginTiming, hashPassword, verifyPassword } from "./password";
import {
  RepositoryConflictError,
  type AccountIdentity,
  type AuthenticatedSession,
} from "./repository";
import {
  authRateLimitPolicies,
  createRateLimitKey,
  type RateLimitPolicy,
} from "./rate-limit";

export const SESSION_COOKIE_NAME = "career_session";
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

interface AuthAttemptContext {
  clientAddress?: string;
  now?: Date;
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function emailRateLimitKey(action: "login" | "registration", email: string) {
  return createRateLimitKey(`${action}:email`, email.trim().toLowerCase());
}

async function consumeAuthRateLimit(
  key: string,
  policy: RateLimitPolicy,
  now: Date,
) {
  const repository = await getRepository();
  const decision = await repository.consumeRateLimit(key, policy, now);
  if (!decision.allowed) {
    throw new RateLimitExceededError(decision.retryAfterSeconds);
  }
  return decision;
}

async function enforceAuthRateLimits(
  action: "login" | "registration",
  email: string,
  context: AuthAttemptContext,
) {
  if (process.env.AUTH_RATE_LIMIT_ENABLED === "false") return;

  const now = context.now ?? new Date();
  const emailPolicy =
    action === "login"
      ? authRateLimitPolicies.loginEmail
      : authRateLimitPolicies.registrationEmail;
  const emailKey = emailRateLimitKey(action, email);
  const emailDecision = await consumeAuthRateLimit(emailKey, emailPolicy, now);

  if (context.clientAddress) {
    const clientPolicy =
      action === "login"
        ? authRateLimitPolicies.loginClient
        : authRateLimitPolicies.registrationClient;
    await consumeAuthRateLimit(
      createRateLimitKey(`${action}:client`, context.clientAddress),
      clientPolicy,
      now,
    );
  }
  return { emailKey, emailDecision };
}

async function issueSession(identity: AccountIdentity, now = new Date()) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);
  const repository = await getRepository();
  await repository.createSession(identity, hashSessionToken(token), expiresAt, now);
  return { token, expiresAt };
}

export async function registerAccount(
  input: {
    email: string;
    displayName: string;
    password: string;
  },
  context: AuthAttemptContext = {},
) {
  await enforceAuthRateLimits("registration", input.email, context);
  const passwordHash = await hashPassword(input.password);
  const repository = await getRepository();
  let identity: AccountIdentity;
  try {
    identity = await repository.createAccount({
      email: input.email,
      displayName: input.displayName,
      passwordHash,
    });
  } catch (error) {
    if (error instanceof RepositoryConflictError) {
      throw new DuplicateAccountError("Email already registered");
    }
    throw error;
  }

  return { identity, ...(await issueSession(identity)) };
}

export async function loginAccount(
  input: { email: string; password: string },
  context: AuthAttemptContext = {},
) {
  const rateLimit = await enforceAuthRateLimits("login", input.email, context);
  const repository = await getRepository();
  const record = await repository.findUserByEmail(input.email);
  if (!record) {
    await consumeLoginTiming(input.password);
    throw new InvalidCredentialsError("Invalid credentials");
  }

  const valid = await verifyPassword(input.password, record.passwordHash);
  if (!valid) throw new InvalidCredentialsError("Invalid credentials");

  const identity: AccountIdentity = {
    user: record.user,
    workspaceId: record.workspaceId,
  };
  if (rateLimit) {
    await repository.clearRateLimit(
      rateLimit.emailKey,
      rateLimit.emailDecision.revision,
    );
  }
  return { identity, ...(await issueSession(identity)) };
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
    priority: "high",
  });
}

export async function getCurrentSession(): Promise<AuthenticatedSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const repository = await getRepository();
  return repository.getSession(hashSessionToken(token));
}

export async function requireCurrentSession() {
  const session = await getCurrentSession();
  if (!session) throw new AuthenticationError("Authentication required");
  return session;
}

export async function logoutCurrentSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    const repository = await getRepository();
    await repository.deleteSession(hashSessionToken(token));
  }
  cookieStore.delete(SESSION_COOKIE_NAME);
}
