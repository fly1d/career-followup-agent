// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteFollowUpStore, type FollowUpStore } from "./store";

describe("SqliteFollowUpStore", () => {
  let directory: string;
  let repository: FollowUpStore;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "career-followup-store-"));
    repository = createSqliteFollowUpStore(join(directory, "test.db"));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("fulfills the asynchronous store contract", async () => {
    expect(repository.backend).toBe("sqlite");
    await expect(repository.checkHealth()).resolves.toBeUndefined();

    const identity = await repository.createAccount({
      email: "STORE@EXAMPLE.COM",
      displayName: "契约用户",
      passwordHash: "password-hash",
    });
    await expect(repository.findUserByEmail("store@example.com")).resolves.toMatchObject(
      identity,
    );

    const createdAt = new Date("2026-08-11T08:00:00.000Z");
    const expiresAt = new Date("2026-09-10T08:00:00.000Z");
    await repository.createSession(identity, "token-hash", expiresAt, createdAt);
    await expect(repository.getSession("token-hash", createdAt)).resolves.toMatchObject(
      identity,
    );

    const created = await repository.createOpportunity(
      identity.workspaceId,
      {
        company: "云帆软件",
        role: "平台产品经理",
        location: "上海",
        salary: "30-40K",
      },
      createdAt,
    );
    const skipped = await repository.updateFollowUp(
      identity.workspaceId,
      created.followUp.id,
      { action: "skip" },
      createdAt,
    );
    expect(skipped.status).toBe("skipped");

    const snapshot = await repository.getWorkspace(identity.workspaceId);
    const updatedSettings = await repository.updateSettings(
      identity.workspaceId,
      { ...snapshot.settings, targetCities: "上海、苏州" },
      createdAt,
    );
    expect(updatedSettings.targetCities).toBe("上海、苏州");

    await repository.deleteSession("token-hash");
    await expect(repository.getSession("token-hash", createdAt)).resolves.toBeNull();
  });
});
