import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  type FollowUpStatus,
  type FollowUpTask,
  type Opportunity,
} from "@/data/demo";
import type { OpportunityStage } from "@/domain/follow-up";
import {
  emptyOnboardingProfile,
  type OnboardingInput,
  type OnboardingProfile,
  type SearchStage,
} from "@/domain/onboarding";
import {
  defaultCandidateSettings,
  type CandidateSettings,
} from "@/domain/settings";
import {
  createWorkspaceSeed,
  prepareFollowUpUpdate,
  prepareNewOpportunity,
} from "./store-records";
import {
  createRateLimitDecision,
  type RateLimitPolicy,
} from "./rate-limit";

export const DEMO_WORKSPACE_ID = "demo-workspace";

type DatabaseRow = Record<string, unknown>;

export interface WorkspaceSnapshot {
  followUps: FollowUpTask[];
  opportunities: Opportunity[];
  settings: CandidateSettings;
  onboarding: OnboardingProfile;
  storage: "server";
}

export interface NewOpportunityInput {
  company: string;
  role: string;
  location: string;
  salary: string;
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
}

export interface AccountIdentity {
  user: PublicUser;
  workspaceId: string;
}

export interface PasswordUserRecord extends AccountIdentity {
  passwordHash: string;
}

export interface AuthenticatedSession extends AccountIdentity {
  expiresAt: string;
}

export type FollowUpMutation =
  | { action: "mark_sent"; message: string }
  | { action: "snooze" }
  | { action: "skip" };

export class RepositoryNotFoundError extends Error {}
export class RepositoryConflictError extends Error {}

const initialSchema = `
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS opportunities (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    company TEXT NOT NULL,
    company_mark TEXT NOT NULL,
    role TEXT NOT NULL,
    location TEXT NOT NULL,
    salary TEXT NOT NULL,
    recruiter TEXT NOT NULL,
    source TEXT NOT NULL,
    stage TEXT NOT NULL,
    stage_label TEXT NOT NULL,
    priority TEXT NOT NULL,
    last_activity_at TEXT NOT NULL,
    next_follow_up_at TEXT,
    resume TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS opportunities_workspace_stage_idx
    ON opportunities(workspace_id, stage);

  CREATE TABLE IF NOT EXISTS follow_up_tasks (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    opportunity_id TEXT NOT NULL,
    company TEXT NOT NULL,
    company_mark TEXT NOT NULL,
    role TEXT NOT NULL,
    recruiter TEXT NOT NULL,
    channel TEXT NOT NULL,
    stage TEXT NOT NULL,
    due_at TEXT NOT NULL,
    reason TEXT NOT NULL,
    context TEXT NOT NULL,
    message TEXT NOT NULL,
    confidence INTEGER NOT NULL,
    status TEXT NOT NULL,
    sent_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS follow_up_tasks_workspace_status_due_idx
    ON follow_up_tasks(workspace_id, status, due_at);

  CREATE TABLE IF NOT EXISTS candidate_settings (
    workspace_id TEXT PRIMARY KEY,
    target_roles TEXT NOT NULL,
    target_cities TEXT NOT NULL,
    minimum_monthly_salary INTEGER NOT NULL,
    exclusions TEXT NOT NULL,
    confirm_before_send INTEGER NOT NULL,
    avoid_weekends INTEGER NOT NULL,
    max_follow_ups INTEGER NOT NULL,
    delivery_start TEXT NOT NULL,
    delivery_end TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS audit_events_workspace_created_idx
    ON audit_events(workspace_id, created_at);
`;

const authenticationSchema = `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE workspace_members (
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, user_id),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX workspace_members_user_idx
    ON workspace_members(user_id, created_at);

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, user_id)
      REFERENCES workspace_members(workspace_id, user_id) ON DELETE CASCADE
  );

  CREATE INDEX sessions_user_expires_idx
    ON sessions(user_id, expires_at);
`;

const authRateLimitSchema = `
  CREATE TABLE auth_rate_limits (
    rate_key TEXT PRIMARY KEY,
    attempt_count INTEGER NOT NULL CHECK(attempt_count >= 1),
    expires_at TEXT NOT NULL,
    revision TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX auth_rate_limits_expires_idx
    ON auth_rate_limits(expires_at);
`;

const onboardingSchema = `
  CREATE TABLE workspace_onboarding (
    workspace_id TEXT PRIMARY KEY,
    target_role TEXT NOT NULL,
    target_city TEXT NOT NULL,
    search_stage TEXT NOT NULL,
    current_opportunity_count INTEGER NOT NULL CHECK(current_opportunity_count >= 0),
    completed_at TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  );

  CREATE UNIQUE INDEX activation_events_workspace_type_idx
    ON audit_events(workspace_id, event_type)
    WHERE event_type IN (
      'activation.account_registered',
      'activation.onboarding_completed',
      'activation.first_opportunity_added',
      'activation.first_follow_up_generated',
      'activation.first_follow_up_confirmed'
    );

  INSERT OR IGNORE INTO workspace_onboarding(
    workspace_id, target_role, target_city, search_stage,
    current_opportunity_count, completed_at, updated_at
  )
  SELECT workspaces.id, '', '', 'actively_applying', 0, NULL, workspaces.created_at
  FROM workspaces
  WHERE EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_members.workspace_id = workspaces.id
  );

  INSERT OR IGNORE INTO audit_events(
    workspace_id, event_type, entity_type, entity_id, payload_json, created_at
  )
  SELECT
    workspaces.id, 'activation.account_registered', 'workspace',
    workspaces.id, '{}', workspaces.created_at
  FROM workspaces
  WHERE EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_members.workspace_id = workspaces.id
  );

  DELETE FROM opportunities
  WHERE workspace_id IN (
    SELECT workspace_id FROM audit_events WHERE event_type = 'workspace.seeded'
  )
  AND EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_members.workspace_id = opportunities.workspace_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM audit_events
    WHERE audit_events.workspace_id = opportunities.workspace_id
      AND audit_events.event_type = 'opportunity.created'
      AND audit_events.entity_id = opportunities.id
  );

  INSERT OR IGNORE INTO audit_events(
    workspace_id, event_type, entity_type, entity_id, payload_json, created_at
  )
  SELECT
    workspaces.id, 'activation.first_opportunity_added', 'opportunity',
    (
      SELECT opportunities.id FROM opportunities
      WHERE opportunities.workspace_id = workspaces.id
      ORDER BY opportunities.created_at, opportunities.id LIMIT 1
    ),
    '{}', workspaces.created_at
  FROM workspaces
  WHERE EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_members.workspace_id = workspaces.id
  )
  AND EXISTS (
    SELECT 1 FROM opportunities
    WHERE opportunities.workspace_id = workspaces.id
  );

  INSERT OR IGNORE INTO audit_events(
    workspace_id, event_type, entity_type, entity_id, payload_json, created_at
  )
  SELECT
    workspaces.id, 'activation.first_follow_up_generated', 'follow_up',
    (
      SELECT follow_up_tasks.id FROM follow_up_tasks
      WHERE follow_up_tasks.workspace_id = workspaces.id
      ORDER BY follow_up_tasks.created_at, follow_up_tasks.id LIMIT 1
    ),
    '{}', workspaces.created_at
  FROM workspaces
  WHERE EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_members.workspace_id = workspaces.id
  )
  AND EXISTS (
    SELECT 1 FROM follow_up_tasks
    WHERE follow_up_tasks.workspace_id = workspaces.id
  );
`;

function mapOpportunity(row: DatabaseRow): Opportunity {
  return {
    id: String(row.id),
    company: String(row.company),
    companyMark: String(row.company_mark),
    role: String(row.role),
    location: String(row.location),
    salary: String(row.salary),
    recruiter: String(row.recruiter),
    source: String(row.source),
    stage: String(row.stage) as OpportunityStage,
    stageLabel: String(row.stage_label),
    priority: String(row.priority) as Opportunity["priority"],
    lastActivityAt: String(row.last_activity_at),
    nextFollowUpAt: row.next_follow_up_at
      ? String(row.next_follow_up_at)
      : undefined,
    resume: String(row.resume),
  };
}

function mapFollowUp(row: DatabaseRow): FollowUpTask {
  return {
    id: String(row.id),
    opportunityId: String(row.opportunity_id),
    company: String(row.company),
    companyMark: String(row.company_mark),
    role: String(row.role),
    recruiter: String(row.recruiter),
    channel: String(row.channel),
    stage: String(row.stage) as OpportunityStage,
    dueAt: String(row.due_at),
    reason: String(row.reason),
    context: String(row.context),
    message: String(row.message),
    confidence: Number(row.confidence),
    status: String(row.status) as FollowUpStatus,
  };
}

function mapSettings(row: DatabaseRow): CandidateSettings {
  return {
    targetRoles: String(row.target_roles),
    targetCities: String(row.target_cities),
    minimumMonthlySalary: Number(row.minimum_monthly_salary),
    exclusions: String(row.exclusions),
    confirmBeforeSend: Boolean(row.confirm_before_send),
    avoidWeekends: Boolean(row.avoid_weekends),
    maxFollowUps: Number(row.max_follow_ups),
    deliveryStart: String(row.delivery_start),
    deliveryEnd: String(row.delivery_end),
  };
}

function mapOnboarding(row?: DatabaseRow): OnboardingProfile {
  if (!row) return emptyOnboardingProfile;
  return {
    targetRole: String(row.target_role),
    targetCity: String(row.target_city),
    searchStage: String(row.search_stage) as SearchStage,
    currentOpportunityCount: Number(row.current_opportunity_count),
    completedAt: row.completed_at ? String(row.completed_at) : null,
  };
}

export class FollowUpRepository {
  constructor(private readonly database: DatabaseSync) {
    this.database.exec("PRAGMA foreign_keys = ON;");
    this.database.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
    this.applyMigration(1, initialSchema);
    this.applyMigration(2, authenticationSchema);
    this.applyMigration(3, authRateLimitSchema);
    this.applyMigration(4, onboardingSchema);
  }

  private applyMigration(version: number, statements: string) {
    const applied = this.database
      .prepare("SELECT version FROM schema_migrations WHERE version = ?")
      .get(version);
    if (applied) return;

    this.transaction(() => {
      this.database.exec(statements);
      this.database
        .prepare(
          "INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)",
        )
        .run(version, new Date().toISOString());
    });
  }

  seedDemoWorkspace(now = new Date()) {
    const exists = this.database
      .prepare("SELECT id FROM workspaces WHERE id = ?")
      .get(DEMO_WORKSPACE_ID);
    if (exists) return;

    const timestamp = now.toISOString();

    this.transaction(() => {
      this.database
        .prepare(
          "INSERT INTO workspaces(id, display_name, created_at) VALUES(?, ?, ?)",
        )
        .run(DEMO_WORKSPACE_ID, "我的求职计划", timestamp);
      this.seedWorkspaceData(DEMO_WORKSPACE_ID, now, false);
    });
  }

  createAccount(
    input: { email: string; displayName: string; passwordHash: string },
    now = new Date(),
  ): AccountIdentity {
    const email = input.email.trim().toLowerCase();
    const duplicate = this.database
      .prepare("SELECT id FROM users WHERE email = ?")
      .get(email);
    if (duplicate) throw new RepositoryConflictError("Email already exists");

    const userId = randomUUID();
    const workspaceId = randomUUID();
    const timestamp = now.toISOString();

    try {
      this.transaction(() => {
        this.database
          .prepare(
            `INSERT INTO users(
              id, email, display_name, password_hash, created_at, updated_at
            ) VALUES(?, ?, ?, ?, ?, ?)`,
          )
          .run(
            userId,
            email,
            input.displayName,
            input.passwordHash,
            timestamp,
            timestamp,
          );
        this.database
          .prepare(
            "INSERT INTO workspaces(id, display_name, created_at) VALUES(?, ?, ?)",
          )
          .run(workspaceId, `${input.displayName}的求职计划`, timestamp);
        this.database
          .prepare(
            `INSERT INTO workspace_members(workspace_id, user_id, role, created_at)
             VALUES(?, ?, 'owner', ?)`,
          )
          .run(workspaceId, userId, timestamp);
        this.initializeAccountWorkspace(workspaceId, timestamp);
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("UNIQUE constraint failed: users.email")
      ) {
        throw new RepositoryConflictError("Email already exists");
      }
      throw error;
    }

    return {
      user: { id: userId, email, displayName: input.displayName },
      workspaceId,
    };
  }

  findUserByEmail(email: string): PasswordUserRecord | null {
    const row = this.database
      .prepare(
        `SELECT
          users.id, users.email, users.display_name, users.password_hash,
          workspace_members.workspace_id
         FROM users
         JOIN workspace_members ON workspace_members.user_id = users.id
         WHERE users.email = ?
         ORDER BY workspace_members.created_at ASC
         LIMIT 1`,
      )
      .get(email.trim().toLowerCase()) as DatabaseRow | undefined;
    if (!row) return null;

    return {
      user: {
        id: String(row.id),
        email: String(row.email),
        displayName: String(row.display_name),
      },
      workspaceId: String(row.workspace_id),
      passwordHash: String(row.password_hash),
    };
  }

  createSession(
    identity: AccountIdentity,
    tokenHash: string,
    expiresAt: Date,
    now = new Date(),
  ) {
    this.database
      .prepare(
        `INSERT INTO sessions(
          token_hash, user_id, workspace_id, expires_at, created_at
        ) VALUES(?, ?, ?, ?, ?)`,
      )
      .run(
        tokenHash,
        identity.user.id,
        identity.workspaceId,
        expiresAt.toISOString(),
        now.toISOString(),
      );
  }

  getSession(tokenHash: string, now = new Date()): AuthenticatedSession | null {
    const row = this.database
      .prepare(
        `SELECT
          users.id, users.email, users.display_name,
          sessions.workspace_id, sessions.expires_at
         FROM sessions
         JOIN users ON users.id = sessions.user_id
         JOIN workspace_members
           ON workspace_members.user_id = sessions.user_id
          AND workspace_members.workspace_id = sessions.workspace_id
         WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
      )
      .get(tokenHash, now.toISOString()) as DatabaseRow | undefined;
    if (!row) return null;

    return {
      user: {
        id: String(row.id),
        email: String(row.email),
        displayName: String(row.display_name),
      },
      workspaceId: String(row.workspace_id),
      expiresAt: String(row.expires_at),
    };
  }

  deleteSession(tokenHash: string) {
    this.database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  }

  consumeRateLimit(key: string, policy: RateLimitPolicy, now = new Date()) {
    const timestamp = now.toISOString();
    const nextExpiry = new Date(now.getTime() + policy.windowMs).toISOString();
    const revision = randomUUID();
    this.database
      .prepare(
        `DELETE FROM auth_rate_limits
         WHERE rate_key IN (
           SELECT rate_key FROM auth_rate_limits
           WHERE expires_at <= ?
           ORDER BY expires_at
           LIMIT 100
         )`,
      )
      .run(timestamp);
    const row = this.database
      .prepare(
        `INSERT INTO auth_rate_limits(
          rate_key, attempt_count, expires_at, revision, updated_at
        ) VALUES(?, 1, ?, ?, ?)
        ON CONFLICT(rate_key) DO UPDATE SET
          attempt_count = CASE
            WHEN auth_rate_limits.expires_at <= excluded.updated_at THEN 1
            ELSE auth_rate_limits.attempt_count + 1
          END,
          expires_at = CASE
            WHEN auth_rate_limits.expires_at <= excluded.updated_at
              THEN excluded.expires_at
            ELSE auth_rate_limits.expires_at
          END,
          revision = excluded.revision,
          updated_at = excluded.updated_at
        RETURNING attempt_count, expires_at, revision`,
      )
      .get(key, nextExpiry, revision, timestamp) as DatabaseRow;
    return createRateLimitDecision(
      Number(row.attempt_count),
      new Date(String(row.expires_at)),
      policy.limit,
      now,
      String(row.revision),
    );
  }

  clearRateLimit(key: string, expectedRevision: string) {
    this.database
      .prepare(
        `DELETE FROM auth_rate_limits
         WHERE rate_key = ? AND revision = ?`,
      )
      .run(key, expectedRevision);
  }

  checkHealth() {
    this.database.prepare("SELECT 1").get();
  }

  getWorkspace(workspaceId: string): WorkspaceSnapshot {
    const workspace = this.database
      .prepare("SELECT id FROM workspaces WHERE id = ?")
      .get(workspaceId);
    if (!workspace) throw new RepositoryNotFoundError("Workspace not found");

    const opportunities = this.database
      .prepare(
        "SELECT * FROM opportunities WHERE workspace_id = ? ORDER BY created_at DESC, id ASC",
      )
      .all(workspaceId)
      .map((row) => mapOpportunity(row as DatabaseRow));
    const followUps = this.database
      .prepare(
        "SELECT * FROM follow_up_tasks WHERE workspace_id = ? ORDER BY due_at ASC, id ASC",
      )
      .all(workspaceId)
      .map((row) => mapFollowUp(row as DatabaseRow));
    const settingsRow = this.database
      .prepare("SELECT * FROM candidate_settings WHERE workspace_id = ?")
      .get(workspaceId) as DatabaseRow | undefined;
    const onboardingRow = this.database
      .prepare("SELECT * FROM workspace_onboarding WHERE workspace_id = ?")
      .get(workspaceId) as DatabaseRow | undefined;

    return {
      opportunities,
      followUps,
      settings: settingsRow
        ? mapSettings(settingsRow)
        : defaultCandidateSettings,
      onboarding: mapOnboarding(onboardingRow),
      storage: "server",
    };
  }

  createOpportunity(
    workspaceId: string,
    input: NewOpportunityInput,
    now = new Date(),
  ) {
    this.requireWorkspace(workspaceId);
    const timestamp = now.toISOString();
    const prepared = prepareNewOpportunity(input, now);
    if (!prepared) {
      throw new RepositoryConflictError("A follow-up could not be scheduled");
    }
    const { opportunity, followUp } = prepared;

    this.transaction(() => {
      const countRow = this.database
        .prepare("SELECT COUNT(*) AS count FROM opportunities WHERE workspace_id = ?")
        .get(workspaceId) as { count: number };
      const isFirstOpportunity = Number(countRow.count) === 0;
      this.insertOpportunity(workspaceId, opportunity, timestamp);
      this.insertFollowUp(workspaceId, followUp, timestamp);
      this.audit(
        workspaceId,
        "opportunity.created",
        "opportunity",
        opportunity.id,
        { source: opportunity.source, stage: opportunity.stage },
        timestamp,
      );
      if (isFirstOpportunity) {
        this.auditOnce(
          workspaceId,
          "activation.first_opportunity_added",
          "opportunity",
          opportunity.id,
          {},
          timestamp,
        );
        this.auditOnce(
          workspaceId,
          "activation.first_follow_up_generated",
          "follow_up",
          followUp.id,
          {},
          timestamp,
        );
      }
    });

    return { opportunity, followUp };
  }

  updateFollowUp(
    workspaceId: string,
    taskId: string,
    mutation: FollowUpMutation,
    now = new Date(),
  ): FollowUpTask {
    const currentRow = this.database
      .prepare(
        "SELECT * FROM follow_up_tasks WHERE id = ? AND workspace_id = ?",
      )
      .get(taskId, workspaceId) as DatabaseRow | undefined;
    if (!currentRow) throw new RepositoryNotFoundError("Follow-up not found");

    const current = mapFollowUp(currentRow);
    if (mutation.action === "mark_sent" && current.status === "sent") {
      return current;
    }
    if (current.status === "sent" || current.status === "skipped") {
      throw new RepositoryConflictError("Follow-up is already final");
    }

    const timestamp = now.toISOString();
    const { followUp, eventType, nextFollowUpAt, sentAt } =
      prepareFollowUpUpdate(current, mutation, now);

    this.transaction(() => {
      this.database
        .prepare(
          `UPDATE follow_up_tasks
           SET status = ?, due_at = ?, message = ?, sent_at = ?, updated_at = ?
           WHERE id = ? AND workspace_id = ?`,
        )
        .run(
          followUp.status,
          followUp.dueAt,
          followUp.message,
          sentAt,
          timestamp,
          taskId,
          workspaceId,
        );
      this.database
        .prepare(
          "UPDATE opportunities SET next_follow_up_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?",
        )
        .run(
          nextFollowUpAt,
          timestamp,
          current.opportunityId,
          workspaceId,
        );
      this.audit(
        workspaceId,
        eventType,
        "follow_up",
        taskId,
        { status: followUp.status, dueAt: followUp.dueAt },
        timestamp,
      );
      const registeredAccount = this.database
        .prepare(
          `SELECT 1 FROM audit_events
           WHERE workspace_id = ? AND event_type = 'activation.account_registered'`,
        )
        .get(workspaceId);
      if (mutation.action === "mark_sent" && registeredAccount) {
        this.auditOnce(
          workspaceId,
          "activation.first_follow_up_confirmed",
          "follow_up",
          taskId,
          {},
          timestamp,
        );
      }
    });

    const updated = this.database
      .prepare("SELECT * FROM follow_up_tasks WHERE id = ?")
      .get(taskId) as DatabaseRow;
    return mapFollowUp(updated);
  }

  updateSettings(
    workspaceId: string,
    settings: CandidateSettings,
    now = new Date(),
  ) {
    this.requireWorkspace(workspaceId);
    const timestamp = now.toISOString();
    this.transaction(() => {
      this.writeSettings(workspaceId, settings, timestamp);
      this.audit(
        workspaceId,
        "settings.updated",
        "candidate_settings",
        workspaceId,
        { maxFollowUps: settings.maxFollowUps },
        timestamp,
      );
    });
    return settings;
  }

  completeOnboarding(
    workspaceId: string,
    input: OnboardingInput,
    now = new Date(),
  ) {
    this.requireWorkspace(workspaceId);
    const timestamp = now.toISOString();
    const settings = {
      ...defaultCandidateSettings,
      ...this.getWorkspace(workspaceId).settings,
      targetRoles: input.targetRole,
      targetCities: input.targetCity,
    };
    let onboarding: OnboardingProfile = { ...input, completedAt: timestamp };

    this.transaction(() => {
      const current = this.database
        .prepare("SELECT completed_at FROM workspace_onboarding WHERE workspace_id = ?")
        .get(workspaceId) as DatabaseRow | undefined;
      const completedAt = current?.completed_at
        ? String(current.completed_at)
        : timestamp;
      this.database
        .prepare(
          `INSERT INTO workspace_onboarding(
            workspace_id, target_role, target_city, search_stage,
            current_opportunity_count, completed_at, updated_at
          ) VALUES(?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(workspace_id) DO UPDATE SET
            target_role = excluded.target_role,
            target_city = excluded.target_city,
            search_stage = excluded.search_stage,
            current_opportunity_count = excluded.current_opportunity_count,
            completed_at = COALESCE(workspace_onboarding.completed_at, excluded.completed_at),
            updated_at = excluded.updated_at`,
        )
        .run(
          workspaceId,
          input.targetRole,
          input.targetCity,
          input.searchStage,
          input.currentOpportunityCount,
          timestamp,
          timestamp,
        );
      this.writeSettings(workspaceId, settings, timestamp);
      this.auditOnce(
        workspaceId,
        "activation.onboarding_completed",
        "workspace_onboarding",
        workspaceId,
        {
          searchStage: input.searchStage,
          currentOpportunityCount: input.currentOpportunityCount,
        },
        timestamp,
      );
      onboarding = { ...input, completedAt };
    });

    return { onboarding, settings };
  }

  countAuditEvents(workspaceId: string) {
    const row = this.database
      .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE workspace_id = ?")
      .get(workspaceId) as { count: number };
    return Number(row.count);
  }

  close() {
    this.database.close();
  }

  private seedWorkspaceData(
    workspaceId: string,
    now: Date,
    regenerateIds: boolean,
  ) {
    const { followUps, opportunities } = createWorkspaceSeed(now, regenerateIds);
    const timestamp = now.toISOString();

    for (const opportunity of opportunities) {
      this.insertOpportunity(workspaceId, opportunity, timestamp);
    }
    for (const followUp of followUps) {
      this.insertFollowUp(workspaceId, followUp, timestamp);
    }
    this.writeSettings(workspaceId, defaultCandidateSettings, timestamp);
    this.audit(
      workspaceId,
      "workspace.seeded",
      "workspace",
      workspaceId,
      { opportunities: opportunities.length, followUps: followUps.length },
      timestamp,
    );
  }

  private initializeAccountWorkspace(workspaceId: string, timestamp: string) {
    this.writeSettings(workspaceId, defaultCandidateSettings, timestamp);
    this.database
      .prepare(
        `INSERT INTO workspace_onboarding(
          workspace_id, target_role, target_city, search_stage,
          current_opportunity_count, completed_at, updated_at
        ) VALUES(?, '', '', 'actively_applying', 0, NULL, ?)`,
      )
      .run(workspaceId, timestamp);
    this.auditOnce(
      workspaceId,
      "activation.account_registered",
      "workspace",
      workspaceId,
      {},
      timestamp,
    );
  }

  private requireWorkspace(workspaceId: string) {
    const workspace = this.database
      .prepare("SELECT id FROM workspaces WHERE id = ?")
      .get(workspaceId);
    if (!workspace) throw new RepositoryNotFoundError("Workspace not found");
  }

  private insertOpportunity(
    workspaceId: string,
    opportunity: Opportunity,
    timestamp: string,
  ) {
    this.database
      .prepare(
        `INSERT INTO opportunities(
          id, workspace_id, company, company_mark, role, location, salary,
          recruiter, source, stage, stage_label, priority, last_activity_at,
          next_follow_up_at, resume, created_at, updated_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        opportunity.id,
        workspaceId,
        opportunity.company,
        opportunity.companyMark,
        opportunity.role,
        opportunity.location,
        opportunity.salary,
        opportunity.recruiter,
        opportunity.source,
        opportunity.stage,
        opportunity.stageLabel,
        opportunity.priority,
        opportunity.lastActivityAt,
        opportunity.nextFollowUpAt ?? null,
        opportunity.resume,
        timestamp,
        timestamp,
      );
  }

  private insertFollowUp(
    workspaceId: string,
    followUp: FollowUpTask,
    timestamp: string,
  ) {
    this.database
      .prepare(
        `INSERT INTO follow_up_tasks(
          id, workspace_id, opportunity_id, company, company_mark, role,
          recruiter, channel, stage, due_at, reason, context, message,
          confidence, status, created_at, updated_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        followUp.id,
        workspaceId,
        followUp.opportunityId,
        followUp.company,
        followUp.companyMark,
        followUp.role,
        followUp.recruiter,
        followUp.channel,
        followUp.stage,
        followUp.dueAt,
        followUp.reason,
        followUp.context,
        followUp.message,
        followUp.confidence,
        followUp.status,
        timestamp,
        timestamp,
      );
  }

  private writeSettings(
    workspaceId: string,
    settings: CandidateSettings,
    timestamp: string,
  ) {
    this.database
      .prepare(
        `INSERT INTO candidate_settings(
          workspace_id, target_roles, target_cities, minimum_monthly_salary,
          exclusions, confirm_before_send, avoid_weekends, max_follow_ups,
          delivery_start, delivery_end, updated_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id) DO UPDATE SET
          target_roles = excluded.target_roles,
          target_cities = excluded.target_cities,
          minimum_monthly_salary = excluded.minimum_monthly_salary,
          exclusions = excluded.exclusions,
          confirm_before_send = excluded.confirm_before_send,
          avoid_weekends = excluded.avoid_weekends,
          max_follow_ups = excluded.max_follow_ups,
          delivery_start = excluded.delivery_start,
          delivery_end = excluded.delivery_end,
          updated_at = excluded.updated_at`,
      )
      .run(
        workspaceId,
        settings.targetRoles,
        settings.targetCities,
        settings.minimumMonthlySalary,
        settings.exclusions,
        settings.confirmBeforeSend ? 1 : 0,
        settings.avoidWeekends ? 1 : 0,
        settings.maxFollowUps,
        settings.deliveryStart,
        settings.deliveryEnd,
        timestamp,
      );
  }

  private audit(
    workspaceId: string,
    eventType: string,
    entityType: string,
    entityId: string,
    payload: object,
    timestamp: string,
  ) {
    this.database
      .prepare(
        `INSERT INTO audit_events(
          workspace_id, event_type, entity_type, entity_id, payload_json, created_at
        ) VALUES(?, ?, ?, ?, ?, ?)`,
      )
      .run(
        workspaceId,
        eventType,
        entityType,
        entityId,
        JSON.stringify(payload),
        timestamp,
      );
  }

  private auditOnce(
    workspaceId: string,
    eventType: string,
    entityType: string,
    entityId: string,
    payload: object,
    timestamp: string,
  ) {
    this.database
      .prepare(
        `INSERT OR IGNORE INTO audit_events(
          workspace_id, event_type, entity_type, entity_id, payload_json, created_at
        ) VALUES(?, ?, ?, ?, ?, ?)`,
      )
      .run(
        workspaceId,
        eventType,
        entityType,
        entityId,
        JSON.stringify(payload),
        timestamp,
      );
  }

  private transaction(operation: () => void) {
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      operation();
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }
}

export function createFollowUpRepository(databasePath: string) {
  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true });
  }
  return new FollowUpRepository(new DatabaseSync(databasePath));
}
