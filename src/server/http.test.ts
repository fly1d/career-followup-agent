// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { errorResponse, parseRequest } from "./http";
import {
  RepositoryConflictError,
  RepositoryNotFoundError,
} from "./repository";
import {
  candidateSettingsSchema,
  followUpMutationSchema,
  newOpportunitySchema,
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
});
