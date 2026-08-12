// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PostgresFollowUpStore,
  type PostgresProvider,
} from "./postgres-store";
import {
  RepositoryConflictError,
  RepositoryNotFoundError,
} from "./repository";

function createProvider(database: PGlite): PostgresProvider {
  const query = async (text: string, values?: unknown[]) => {
    if (!values && text.includes(";")) {
      await database.exec(text);
      return { rows: [], rowCount: null };
    }
    const result = await database.query<Record<string, unknown>>(text, values);
    return {
      rows: result.rows,
      rowCount: result.affectedRows ?? null,
    };
  };
  return {
    query,
    async connect() {
      return { query, release() {} };
    },
  };
}

describe("PostgresFollowUpStore", () => {
  let database: PGlite;
  let repository: PostgresFollowUpStore;

  beforeEach(async () => {
    database = new PGlite();
    repository = await PostgresFollowUpStore.create(createProvider(database));
  });

  afterEach(async () => {
    await database.close();
  });

  it("applies its migration idempotently", async () => {
    await PostgresFollowUpStore.create(createProvider(database));
    const migrations = await database.query<{ version: number }>(
      "SELECT version FROM schema_migrations ORDER BY version",
    );

    expect(migrations.rows).toEqual([{ version: 1 }, { version: 2 }]);
    await expect(repository.checkHealth()).resolves.toBeUndefined();
  });

  it("releases failed transactions without hiding the original error", async () => {
    const originalError = new Error("insert failed");
    let releaseCount = 0;
    const queries: string[] = [];
    const provider: PostgresProvider = {
      async query() {
        return { rows: [], rowCount: null };
      },
      async connect() {
        return {
          async query(text) {
            queries.push(text);
            if (text.includes("SELECT version")) {
              return { rows: [{ version: 1 }], rowCount: 1 };
            }
            if (text.startsWith("INSERT INTO users")) throw originalError;
            if (text === "ROLLBACK") throw new Error("rollback failed");
            return { rows: [], rowCount: null };
          },
          release() {
            releaseCount += 1;
          },
        };
      },
    };
    const failingRepository = await PostgresFollowUpStore.create(provider);

    await expect(
      failingRepository.createAccount({
        email: "failure@example.com",
        displayName: "故障测试",
        passwordHash: "password-hash",
      }),
    ).rejects.toBe(originalError);
    expect(queries).toContain("ROLLBACK");
    expect(releaseCount).toBe(2);
  });

  it("creates case-insensitive, isolated account workspaces", async () => {
    const first = await repository.createAccount({
      email: "FIRST@EXAMPLE.COM",
      displayName: "林岚",
      passwordHash: "first-hash",
    });
    const second = await repository.createAccount({
      email: "second@example.com",
      displayName: "周宁",
      passwordHash: "second-hash",
    });

    expect(first.user.email).toBe("first@example.com");
    expect(first.workspaceId).not.toBe(second.workspaceId);
    const firstSnapshot = await repository.getWorkspace(first.workspaceId);
    const secondSnapshot = await repository.getWorkspace(second.workspaceId);
    expect(firstSnapshot.opportunities).toHaveLength(4);
    expect(firstSnapshot.followUps).toHaveLength(3);
    expect(firstSnapshot.opportunities[0].id).not.toBe(
      secondSnapshot.opportunities[0].id,
    );
    await expect(
      database.query(
        "UPDATE follow_up_tasks SET workspace_id = $1 WHERE id = $2",
        [second.workspaceId, firstSnapshot.followUps[0].id],
      ),
    ).rejects.toThrow();
    await expect(
      repository.createAccount({
        email: "First@Example.com",
        displayName: "重复账号",
        passwordHash: "duplicate-hash",
      }),
    ).rejects.toBeInstanceOf(RepositoryConflictError);
  });

  it("resolves, expires, and revokes database sessions", async () => {
    const identity = await repository.createAccount({
      email: "session@example.com",
      displayName: "会话用户",
      passwordHash: "password-hash",
    });
    const createdAt = new Date("2026-08-11T08:00:00.000Z");
    const expiresAt = new Date("2026-09-10T08:00:00.000Z");
    await repository.createSession(identity, "token-hash", expiresAt, createdAt);

    await expect(
      repository.getSession(
        "token-hash",
        new Date("2026-08-12T08:00:00.000Z"),
      ),
    ).resolves.toMatchObject({
      user: { email: "session@example.com" },
      workspaceId: identity.workspaceId,
      expiresAt: expiresAt.toISOString(),
    });
    await expect(
      repository.getSession("token-hash", expiresAt),
    ).resolves.toBeNull();

    await repository.deleteSession("token-hash");
    await expect(repository.getSession("token-hash", createdAt)).resolves.toBeNull();
  });

  it("atomically limits attempts and resets expired or cleared buckets", async () => {
    const policy = { limit: 2, windowMs: 60_000 };
    const startedAt = new Date("2026-08-11T08:00:00.000Z");

    await expect(
      repository.consumeRateLimit("login-key", policy, startedAt),
    ).resolves.toMatchObject({ allowed: true, attemptCount: 1, retryAfterSeconds: 0 });
    await repository.consumeRateLimit(
      "login-key",
      policy,
      new Date("2026-08-11T08:00:10.000Z"),
    );
    await expect(
      repository.consumeRateLimit(
        "login-key",
        policy,
        new Date("2026-08-11T08:00:20.000Z"),
      ),
    ).resolves.toMatchObject({
      allowed: false,
      attemptCount: 3,
      retryAfterSeconds: 40,
    });
    await expect(
      repository.consumeRateLimit(
        "login-key",
        policy,
        new Date("2026-08-11T08:01:00.000Z"),
      ),
    ).resolves.toMatchObject({ allowed: true, attemptCount: 1, retryAfterSeconds: 0 });

    const current = await repository.consumeRateLimit("clear-key", policy, startedAt);
    await repository.clearRateLimit("clear-key", current.revision);
    await expect(
      repository.consumeRateLimit("clear-key", policy, startedAt),
    ).resolves.toMatchObject({ allowed: true, attemptCount: 1, retryAfterSeconds: 0 });

    const stale = await repository.consumeRateLimit("stale-key", policy, startedAt);
    await repository.consumeRateLimit(
      "stale-key",
      policy,
      new Date("2026-08-11T08:00:01.000Z"),
    );
    await repository.clearRateLimit("stale-key", stale.revision);
    await expect(
      repository.consumeRateLimit(
        "stale-key",
        policy,
        new Date("2026-08-11T08:00:02.000Z"),
      ),
    ).resolves.toMatchObject({ allowed: false, attemptCount: 3 });
  });

  it("keeps mutations scoped and records sent follow-ups idempotently", async () => {
    const first = await repository.createAccount({
      email: "owner@example.com",
      displayName: "账号一",
      passwordHash: "first-hash",
    });
    const second = await repository.createAccount({
      email: "member@example.com",
      displayName: "账号二",
      passwordHash: "second-hash",
    });
    const created = await repository.createOpportunity(
      first.workspaceId,
      {
        company: "云帆软件",
        role: "平台产品经理",
        location: "上海",
        salary: "30-40K",
      },
      new Date("2026-08-10T07:00:00.000Z"),
    );

    await expect(
      repository.updateFollowUp(second.workspaceId, created.followUp.id, {
        action: "skip",
      }),
    ).rejects.toBeInstanceOf(RepositoryNotFoundError);

    const firstSent = await repository.updateFollowUp(
      first.workspaceId,
      created.followUp.id,
      { action: "mark_sent", message: "已确认的追问内容" },
      new Date("2026-08-11T09:00:00.000Z"),
    );
    const repeated = await repository.updateFollowUp(
      first.workspaceId,
      created.followUp.id,
      { action: "mark_sent", message: "不应覆盖" },
      new Date("2026-08-11T09:01:00.000Z"),
    );
    expect(firstSent.status).toBe("sent");
    expect(repeated.message).toBe("已确认的追问内容");

    const events = await database.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM audit_events
       WHERE workspace_id = $1 AND event_type = 'follow_up.sent_recorded'`,
      [first.workspaceId],
    );
    expect(events.rows[0].count).toBe(1);
  });

  it("persists settings with native PostgreSQL booleans", async () => {
    const identity = await repository.createAccount({
      email: "settings@example.com",
      displayName: "设置用户",
      passwordHash: "password-hash",
    });
    const current = (await repository.getWorkspace(identity.workspaceId)).settings;
    await repository.updateSettings(identity.workspaceId, {
      ...current,
      targetCities: "上海、苏州",
      confirmBeforeSend: false,
      avoidWeekends: false,
    });

    const saved = (await repository.getWorkspace(identity.workspaceId)).settings;
    expect(saved.targetCities).toBe("上海、苏州");
    expect(saved.confirmBeforeSend).toBe(false);
    expect(saved.avoidWeekends).toBe(false);
  });
});
