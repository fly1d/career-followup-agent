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

    expect(migrations).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
      { version: 5 },
    ]);
  });

  it("records pilot interest and activates 30-day access idempotently", () => {
    const identity = repository.createAccount({
      email: "pilot@example.com",
      displayName: "首批用户",
      passwordHash: "password-hash",
    });
    const requestedAt = new Date("2026-08-12T08:00:00.000Z");
    const first = repository.requestPilotEnrollment(
      identity.workspaceId,
      {
        contactMethod: "wechat",
        contactValue: "pilot-wechat",
        note: "面试后追问",
      },
      requestedAt,
    );
    const repeated = repository.requestPilotEnrollment(
      identity.workspaceId,
      {
        contactMethod: "phone",
        contactValue: "13800000000",
        note: "改用手机联系",
      },
      new Date("2026-08-12T09:00:00.000Z"),
    );

    expect(first.status).toBe("pending_payment");
    expect(repeated.orderId).toBe(first.orderId);
    const pendingOperations = repository.getPilotOperations(requestedAt);
    expect(pendingOperations.funnel).toMatchObject({
      registered: 1,
      purchaseRequested: 1,
      paymentConfirmed: 0,
    });
    expect(pendingOperations.orders[0]).toMatchObject({
      contactMethod: "phone",
      contactValue: "13800000000",
      note: "改用手机联系",
      status: "pending_payment",
    });

    const paidAt = new Date("2026-08-13T08:00:00.000Z");
    const activated = repository.confirmPilotPayment(
      first.orderId!,
      "admin@example.com",
      paidAt,
    );
    const repeatedConfirmation = repository.confirmPilotPayment(
      first.orderId!,
      "other-admin@example.com",
      new Date("2026-08-13T09:00:00.000Z"),
    );
    expect(activated.offer.confirmedCount).toBe(1);
    expect(repeatedConfirmation.offer.confirmedCount).toBe(1);
    expect(
      repository.getWorkspace(identity.workspaceId, paidAt).pilot,
    ).toMatchObject({
      status: "active",
      startsAt: paidAt.toISOString(),
      endsAt: "2026-09-12T08:00:00.000Z",
    });
    expect(
      repository.getWorkspace(
        identity.workspaceId,
        new Date("2026-09-12T08:00:00.000Z"),
      ).pilot.status,
    ).toBe("expired");
    expect(repeatedConfirmation.orders[0].confirmedBy).toBe("admin@example.com");
    expect(repository.countAuditEvents(identity.workspaceId)).toBe(3);
  });

  it("caps the first cohort at ten confirmed payments", () => {
    const requests: Array<{ workspaceId: string; orderId: string }> = [];
    for (let index = 0; index < 11; index += 1) {
      const identity = repository.createAccount({
        email: `capacity-${index}@example.com`,
        displayName: `名额用户${index}`,
        passwordHash: "password-hash",
      });
      const request = repository.requestPilotEnrollment(identity.workspaceId, {
        contactMethod: "email",
        contactValue: `capacity-${index}@example.com`,
        note: "",
      });
      requests.push({
        workspaceId: identity.workspaceId,
        orderId: request.orderId!,
      });
    }
    for (const request of requests.slice(0, 10)) {
      repository.confirmPilotPayment(request.orderId, "admin@example.com");
    }

    const operations = repository.getPilotOperations();
    expect(operations.offer).toMatchObject({
      confirmedCount: 10,
      remainingCount: 0,
    });
    expect(repository.getWorkspace(requests[10].workspaceId).pilot.status).toBe(
      "full",
    );
    expect(() =>
      repository.confirmPilotPayment(
        requests[10].orderId,
        "admin@example.com",
      ),
    ).toThrow(RepositoryConflictError);
  });

  it("removes legacy seeded records while preserving real account opportunities", () => {
    const identity = repository.createAccount({
      email: "legacy@example.com",
      displayName: "历史用户",
      passwordHash: "password-hash",
    });
    const real = repository.createOpportunity(identity.workspaceId, {
      company: "真实公司",
      role: "产品经理",
      location: "上海",
      salary: "",
    });
    repository.close();

    const database = new DatabaseSync(join(directory, "test.db"));
    database
      .prepare(
        `INSERT INTO opportunities(
          id, workspace_id, company, company_mark, role, location, salary,
          recruiter, source, stage, stage_label, priority, last_activity_at,
          next_follow_up_at, resume, created_at, updated_at
        )
        SELECT
          'legacy-seed-opportunity', workspace_id, '演示公司', '演', role,
          location, salary, recruiter, '演示数据', stage, stage_label, priority,
          last_activity_at, NULL, resume, created_at, updated_at
        FROM opportunities WHERE id = ?`,
      )
      .run(real.opportunity.id);
    database
      .prepare(
        `INSERT INTO audit_events(
          workspace_id, event_type, entity_type, entity_id, payload_json, created_at
        ) VALUES(?, 'workspace.seeded', 'workspace', ?, '{}', ?)`,
      )
      .run(identity.workspaceId, identity.workspaceId, new Date().toISOString());
    database
      .prepare("DELETE FROM audit_events WHERE workspace_id = ? AND event_type LIKE 'activation.%'")
      .run(identity.workspaceId);
    database.exec(`
      DROP INDEX activation_events_workspace_type_idx;
      DROP TABLE workspace_onboarding;
      DELETE FROM schema_migrations WHERE version = 4;
    `);
    database.close();

    repository = createFollowUpRepository(join(directory, "test.db"));
    const snapshot = repository.getWorkspace(identity.workspaceId);
    expect(snapshot.opportunities.map((item) => item.id)).toEqual([
      real.opportunity.id,
    ]);
    expect(snapshot.followUps).toHaveLength(1);
    expect(snapshot.onboarding.completedAt).toBeNull();
    expect(repository.countAuditEvents(identity.workspaceId)).toBe(5);
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

  it("creates isolated empty account workspaces and records activation once", () => {
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
    expect(firstSnapshot.opportunities).toEqual([]);
    expect(firstSnapshot.followUps).toEqual([]);
    expect(firstSnapshot.onboarding.completedAt).toBeNull();
    expect(secondSnapshot.opportunities).toEqual([]);

    const completed = repository.completeOnboarding(
      first.workspaceId,
      {
        targetRole: "AI 产品经理",
        targetCity: "上海",
        searchStage: "actively_applying",
        currentOpportunityCount: 3,
      },
      new Date("2026-08-12T08:00:00.000Z"),
    );
    const repeated = repository.completeOnboarding(
      first.workspaceId,
      {
        targetRole: "平台产品经理",
        targetCity: "上海、苏州",
        searchStage: "interviewing",
        currentOpportunityCount: 4,
      },
      new Date("2026-08-12T09:00:00.000Z"),
    );
    expect(completed.onboarding.completedAt).toBe("2026-08-12T08:00:00.000Z");
    expect(repeated.onboarding.completedAt).toBe(completed.onboarding.completedAt);
    expect(repository.countAuditEvents(first.workspaceId)).toBe(2);

    const firstCreated = repository.createOpportunity(first.workspaceId, {
      company: "云帆软件",
      role: "平台产品经理",
      location: "上海",
      salary: "30-40K",
    });
    repository.createOpportunity(first.workspaceId, {
      company: "山海数据",
      role: "产品负责人",
      location: "苏州",
      salary: "",
    });
    expect(repository.countAuditEvents(first.workspaceId)).toBe(6);
    expect(() =>
      repository.updateFollowUp(
        second.workspaceId,
        firstCreated.followUp.id,
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
