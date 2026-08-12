// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFollowUpRepository,
  DEMO_WORKSPACE_ID,
  type FollowUpRepository,
  RepositoryConflictError,
  RepositoryNotFoundError,
} from "./repository";

describe("FollowUpRepository", () => {
  let directory: string;
  let repository: FollowUpRepository;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "career-followup-"));
    repository = createFollowUpRepository(join(directory, "test.db"));
    repository.seedDemoWorkspace(new Date(2026, 7, 11, 16));
  });

  afterEach(() => {
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("seeds and reads an isolated server workspace", () => {
    const snapshot = repository.getWorkspace(DEMO_WORKSPACE_ID);

    expect(snapshot.storage).toBe("server");
    expect(snapshot.opportunities).toHaveLength(4);
    expect(snapshot.followUps).toHaveLength(3);
    expect(snapshot.settings.confirmBeforeSend).toBe(true);
    expect(repository.countAuditEvents(DEMO_WORKSPACE_ID)).toBe(1);
    expect(() => repository.getWorkspace("another-workspace")).toThrow(
      RepositoryNotFoundError,
    );
  });

  it("applies versioned migrations idempotently", () => {
    repository.close();
    repository = createFollowUpRepository(join(directory, "test.db"));
    repository.close();

    const database = new DatabaseSync(join(directory, "test.db"));
    const migrations = database
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all();
    database.close();
    repository = createFollowUpRepository(join(directory, "test.db"));

    expect(migrations).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }]);
  });

  it("creates an opportunity and its first scheduled follow-up atomically", () => {
    const result = repository.createOpportunity(
      DEMO_WORKSPACE_ID,
      {
        company: "云帆软件",
        role: "平台产品经理",
        location: "上海",
        salary: "30-40K",
      },
      new Date(2026, 7, 10, 15),
    );

    expect(result.opportunity.nextFollowUpAt).toBe(
      new Date(2026, 7, 13, 10).toISOString(),
    );
    expect(result.followUp.status).toBe("scheduled");
    expect(result.followUp.opportunityId).toBe(result.opportunity.id);
    expect(repository.getWorkspace(DEMO_WORKSPACE_ID).opportunities).toHaveLength(5);
    expect(repository.countAuditEvents(DEMO_WORKSPACE_ID)).toBe(2);
  });

  it("fails closed when creating data for an unknown workspace", () => {
    expect(() =>
      repository.createOpportunity("another-workspace", {
        company: "云帆软件",
        role: "平台产品经理",
        location: "上海",
        salary: "30-40K",
      }),
    ).toThrow(RepositoryNotFoundError);
  });

  it("records a sent follow-up idempotently", () => {
    const task = repository.getWorkspace(DEMO_WORKSPACE_ID).followUps[0];
    const auditCount = repository.countAuditEvents(DEMO_WORKSPACE_ID);

    const first = repository.updateFollowUp(
      DEMO_WORKSPACE_ID,
      task.id,
      { action: "mark_sent", message: "已确认的追问内容" },
      new Date(2026, 7, 11, 17),
    );
    const repeated = repository.updateFollowUp(
      DEMO_WORKSPACE_ID,
      task.id,
      { action: "mark_sent", message: "不会覆盖第一次结果" },
      new Date(2026, 7, 11, 17, 1),
    );

    expect(first.status).toBe("sent");
    expect(repeated.message).toBe("已确认的追问内容");
    expect(repository.countAuditEvents(DEMO_WORKSPACE_ID)).toBe(auditCount + 1);
    const opportunity = repository
      .getWorkspace(DEMO_WORKSPACE_ID)
      .opportunities.find((item) => item.id === task.opportunityId);
    expect(opportunity?.nextFollowUpAt).toBeUndefined();
    expect(() =>
      repository.updateFollowUp(DEMO_WORKSPACE_ID, task.id, { action: "snooze" }),
    ).toThrow(RepositoryConflictError);
  });

  it("snoozes to the next business morning", () => {
    const task = repository.getWorkspace(DEMO_WORKSPACE_ID).followUps[1];
    const updated = repository.updateFollowUp(
      DEMO_WORKSPACE_ID,
      task.id,
      { action: "snooze" },
      new Date(2026, 7, 14, 16),
    );

    expect(updated.status).toBe("scheduled");
    expect(updated.dueAt).toBe(new Date(2026, 7, 17, 10).toISOString());
  });

  it("skips an active task and rejects unknown task ids", () => {
    const task = repository.getWorkspace(DEMO_WORKSPACE_ID).followUps[1];
    const updated = repository.updateFollowUp(DEMO_WORKSPACE_ID, task.id, {
      action: "skip",
    });

    expect(updated.status).toBe("skipped");
    expect(() =>
      repository.updateFollowUp(DEMO_WORKSPACE_ID, "missing", { action: "skip" }),
    ).toThrow(RepositoryNotFoundError);
  });

  it("persists candidate settings", () => {
    const current = repository.getWorkspace(DEMO_WORKSPACE_ID).settings;
    repository.updateSettings(DEMO_WORKSPACE_ID, {
      ...current,
      targetCities: "上海、苏州",
      minimumMonthlySalary: 32,
      maxFollowUps: 1,
      confirmBeforeSend: false,
    });

    const saved = repository.getWorkspace(DEMO_WORKSPACE_ID).settings;
    expect(saved.targetCities).toBe("上海、苏州");
    expect(saved.minimumMonthlySalary).toBe(32);
    expect(saved.maxFollowUps).toBe(1);
    expect(saved.confirmBeforeSend).toBe(false);
  });

  it("creates isolated account workspaces with independent example records", () => {
    const first = repository.createAccount({
      email: "FIRST@EXAMPLE.COM",
      displayName: "林岚",
      passwordHash: "first-hash",
    });
    const second = repository.createAccount({
      email: "second@example.com",
      displayName: "周宁",
      passwordHash: "second-hash",
    });

    expect(first.user.email).toBe("first@example.com");
    expect(first.workspaceId).not.toBe(second.workspaceId);
    const firstSnapshot = repository.getWorkspace(first.workspaceId);
    const secondSnapshot = repository.getWorkspace(second.workspaceId);
    expect(firstSnapshot.opportunities).toHaveLength(4);
    expect(secondSnapshot.opportunities).toHaveLength(4);
    expect(firstSnapshot.opportunities[0].id).not.toBe(
      secondSnapshot.opportunities[0].id,
    );
    expect(() =>
      repository.updateFollowUp(
        second.workspaceId,
        firstSnapshot.followUps[0].id,
        { action: "skip" },
      ),
    ).toThrow(RepositoryNotFoundError);
    expect(() =>
      repository.createAccount({
        email: "first@example.com",
        displayName: "重复账号",
        passwordHash: "another-hash",
      }),
    ).toThrow(RepositoryConflictError);
  });

  it("resolves, expires, and revokes opaque sessions", () => {
    const identity = repository.createAccount({
      email: "session@example.com",
      displayName: "会话用户",
      passwordHash: "password-hash",
    });
    const createdAt = new Date("2026-08-11T08:00:00.000Z");
    const expiresAt = new Date("2026-09-10T08:00:00.000Z");
    repository.createSession(identity, "token-hash", expiresAt, createdAt);

    expect(
      repository.getSession("token-hash", new Date("2026-08-12T08:00:00.000Z")),
    ).toMatchObject({
      user: { email: "session@example.com", displayName: "会话用户" },
      workspaceId: identity.workspaceId,
      expiresAt: expiresAt.toISOString(),
    });
    expect(
      repository.getSession("token-hash", new Date("2026-09-10T08:00:00.000Z")),
    ).toBeNull();

    repository.deleteSession("token-hash");
    expect(repository.getSession("token-hash", createdAt)).toBeNull();
  });

  it("atomically limits attempts and resets expired or cleared buckets", () => {
    const policy = { limit: 2, windowMs: 60_000 };
    const startedAt = new Date("2026-08-11T08:00:00.000Z");

    expect(repository.consumeRateLimit("login-key", policy, startedAt).allowed).toBe(
      true,
    );
    expect(
      repository.consumeRateLimit(
        "login-key",
        policy,
        new Date("2026-08-11T08:00:10.000Z"),
      ).allowed,
    ).toBe(true);
    expect(
      repository.consumeRateLimit(
        "login-key",
        policy,
        new Date("2026-08-11T08:00:20.000Z"),
      ),
    ).toMatchObject({ allowed: false, attemptCount: 3, retryAfterSeconds: 40 });
    expect(
      repository.consumeRateLimit(
        "login-key",
        policy,
        new Date("2026-08-11T08:01:00.000Z"),
      ).allowed,
    ).toBe(true);

    const current = repository.consumeRateLimit("clear-key", policy, startedAt);
    repository.clearRateLimit("clear-key", current.revision);
    expect(repository.consumeRateLimit("clear-key", policy, startedAt).allowed).toBe(
      true,
    );

    const stale = repository.consumeRateLimit("stale-key", policy, startedAt);
    repository.consumeRateLimit(
      "stale-key",
      policy,
      new Date("2026-08-11T08:00:01.000Z"),
    );
    repository.clearRateLimit("stale-key", stale.revision);
    expect(
      repository.consumeRateLimit(
        "stale-key",
        policy,
        new Date("2026-08-11T08:00:02.000Z"),
      ).allowed,
    ).toBe(false);
  });
});
