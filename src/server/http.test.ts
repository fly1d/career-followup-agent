// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  AuthenticationError,
  DuplicateAccountError,
  InvalidCredentialsError,
  RateLimitExceededError,
} from "./errors";
import { errorResponse, parseRequest } from "./http";
import {
  RepositoryConflictError,
  RepositoryNotFoundError,
} from "./repository";
import {
  candidateSettingsSchema,
  followUpMutationSchema,
  loginSchema,
  newOpportunitySchema,
  onboardingSchema,
  pilotAdminActionSchema,
  pilotRequestSchema,
  registrationSchema,
} from "./schemas";

describe("parseRequest", () => {
  const schema = z.object({ name: z.string().min(1) });

  it("returns validated JSON", async () => {
    const result = await parseRequest(
      new Request("http://localhost/test", {
        method: "POST",
        body: JSON.stringify({ name: "valid" }),
      }),
      schema,
    );

    expect(result).toEqual({ name: "valid" });
  });

  it("rejects invalid JSON", async () => {
    const result = await parseRequest(
      new Request("http://localhost/test", { method: "POST", body: "{" }),
      schema,
    );

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(400);
    expect(await (result as Response).json()).toMatchObject({
      error: { code: "invalid_json" },
    });
  });

  it("returns field errors for invalid input", async () => {
    const result = await parseRequest(
      new Request("http://localhost/test", {
        method: "POST",
        body: JSON.stringify({ name: "" }),
      }),
      schema,
    );

    expect(result).toBeInstanceOf(Response);
    expect(await (result as Response).json()).toMatchObject({
      error: { code: "validation_failed", fields: { name: expect.any(Array) } },
    });
  });
});

describe("errorResponse", () => {
  it("maps repository errors without exposing internals", async () => {
    const missing = errorResponse(new RepositoryNotFoundError("secret path"));
    const conflict = errorResponse(new RepositoryConflictError("secret state"));

    expect(missing.status).toBe(404);
    expect(conflict.status).toBe(409);
    expect(JSON.stringify(await missing.json())).not.toContain("secret path");
  });

  it("maps unexpected failures to a generic 500", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = errorResponse(new Error("database password"));

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("database password");
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it("maps authentication failures without exposing internal details", async () => {
    const missing = errorResponse(new AuthenticationError("raw token"));
    const credentials = errorResponse(new InvalidCredentialsError("known email"));
    const duplicate = errorResponse(new DuplicateAccountError("database row"));

    expect(missing.status).toBe(401);
    expect(credentials.status).toBe(401);
    expect(duplicate.status).toBe(409);
    expect(JSON.stringify(await credentials.json())).not.toContain("known email");
  });

  it("returns a standard retry delay for rate limits", async () => {
    const response = errorResponse(new RateLimitExceededError(321));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("321");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "rate_limited" },
    });
  });
});

describe("API schemas", () => {
  it("rejects incomplete opportunities and follow-up messages", () => {
    expect(
      newOpportunitySchema.safeParse({
        company: " ",
        role: "产品经理",
        location: "上海",
        salary: "",
      }).success,
    ).toBe(false);
    expect(
      followUpMutationSchema.safeParse({ action: "mark_sent", message: " " })
        .success,
    ).toBe(false);
  });

  it("rejects unsafe scheduling settings", () => {
    expect(
      candidateSettingsSchema.safeParse({
        targetRoles: "产品经理",
        targetCities: "上海",
        minimumMonthlySalary: 28,
        exclusions: "",
        confirmBeforeSend: true,
        avoidWeekends: true,
        maxFollowUps: 8,
        deliveryStart: "25:00",
        deliveryEnd: "18:30",
      }).success,
    ).toBe(false);
  });

  it("validates onboarding stages and opportunity counts", () => {
    expect(
      onboardingSchema.safeParse({
        targetRole: "产品经理",
        targetCity: "上海",
        searchStage: "interviewing",
        currentOpportunityCount: 3,
      }).success,
    ).toBe(true);
    expect(
      onboardingSchema.safeParse({
        targetRole: "产品经理",
        targetCity: "上海",
        searchStage: "unknown",
        currentOpportunityCount: -1,
      }).success,
    ).toBe(false);
  });

  it("validates pilot contact details and admin actions", () => {
    expect(
      pilotRequestSchema.safeParse({
        contactMethod: "wechat",
        contactValue: "pilot-user",
        note: "面试后跟进",
      }).success,
    ).toBe(true);
    expect(
      pilotRequestSchema.safeParse({
        contactMethod: "telegram",
        contactValue: " ",
        note: "x".repeat(501),
      }).success,
    ).toBe(false);
    expect(
      pilotAdminActionSchema.safeParse({ action: "confirm_payment" }).success,
    ).toBe(true);
    expect(
      pilotAdminActionSchema.safeParse({ action: "activate_without_payment" })
        .success,
    ).toBe(false);
  });

  it("normalizes account emails and enforces strong registration passwords", () => {
    const valid = registrationSchema.safeParse({
      displayName: " 林岚 ",
      email: " LIN@example.COM ",
      password: "secure-pass-2026",
    });
    expect(valid.success && valid.data).toMatchObject({
      displayName: "林岚",
      email: "lin@example.com",
    });
    expect(
      registrationSchema.safeParse({
        displayName: "林岚",
        email: "invalid",
        password: "onlyletters",
      }).success,
    ).toBe(false);
    expect(
      loginSchema.safeParse({ email: "USER@EXAMPLE.COM", password: "x" }),
    ).toMatchObject({ success: true, data: { email: "user@example.com" } });
  });
});
