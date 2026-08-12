// @vitest-environment node

import { describe, expect, it } from "vitest";
import { isPilotAdminIdentity } from "./pilot-admin-policy";

describe("pilot administrator authorization", () => {
  it("authorizes configured database user IDs", () => {
    expect(
      isPilotAdminIdentity(
        { id: "admin-id", email: "another@example.com" },
        {
          environment: "production",
          adminUserIds: "first-id, ADMIN-ID ",
          adminEmails: "operator@example.com",
        },
      ),
    ).toBe(true);
    expect(
      isPilotAdminIdentity(
        { id: "unknown-id", email: "operator@example.com" },
        {
          environment: "production",
          adminUserIds: "first-id, ADMIN-ID ",
          adminEmails: "operator@example.com",
        },
      ),
    ).toBe(false);
  });

  it("allows email authorization only outside production", () => {
    expect(
      isPilotAdminIdentity(
        { id: "unknown-id", email: "operator@example.com" },
        {
          environment: "test",
          adminEmails: " Operator@Example.com ",
        },
      ),
    ).toBe(true);

    expect(
      isPilotAdminIdentity(
        { id: "unknown-id", email: "operator@example.com" },
        {
          environment: "production",
          adminEmails: " Operator@Example.com ",
        },
      ),
    ).toBe(false);
  });
});
