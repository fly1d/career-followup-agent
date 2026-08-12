import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import type { FollowUpTask, Opportunity } from "@/data/demo";
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
  RepositoryConflictError,
  RepositoryNotFoundError,
  type AccountIdentity,
  type AuthenticatedSession,
  type FollowUpMutation,
  type NewOpportunityInput,
  type PasswordUserRecord,
  type WorkspaceSnapshot,
} from "./repository";
import {
  prepareFollowUpUpdate,
  prepareNewOpportunity,
} from "./store-records";
import type { FollowUpStore } from "./store";
import {
  createRateLimitDecision,
  type RateLimitPolicy,
} from "./rate-limit";

type DatabaseRow = Record<string, unknown>;

export interface PostgresConnection {
  query(text: string, values?: unknown[]): Promise<{
    rows: DatabaseRow[];
    rowCount: number | null;
  }>;
}

export interface PostgresTransactionConnection extends PostgresConnection {
  release(): void;
}

export interface PostgresProvider extends PostgresConnection {
  connect(): Promise<PostgresTransactionConnection>;
}

const postgresSchema = `
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx
    ON users(lower(email));

  CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (workspace_id, user_id),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS workspace_members_user_idx
    ON workspace_members(user_id, created_at);

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
    last_activity_at TIMESTAMPTZ NOT NULL,
    next_follow_up_at TIMESTAMPTZ,
    resume TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    UNIQUE (workspace_id, id),
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
    due_at TIMESTAMPTZ NOT NULL,
    reason TEXT NOT NULL,
    context TEXT NOT NULL,
    message TEXT NOT NULL,
    confidence INTEGER NOT NULL,
    status TEXT NOT NULL,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, opportunity_id)
      REFERENCES opportunities(workspace_id, id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS follow_up_tasks_workspace_status_due_idx
    ON follow_up_tasks(workspace_id, status, due_at);

  CREATE TABLE IF NOT EXISTS candidate_settings (
    workspace_id TEXT PRIMARY KEY,
    target_roles TEXT NOT NULL,
    target_cities TEXT NOT NULL,
    minimum_monthly_salary INTEGER NOT NULL,
    exclusions TEXT NOT NULL,
    confirm_before_send BOOLEAN NOT NULL,
    avoid_weekends BOOLEAN NOT NULL,
    max_follow_ups INTEGER NOT NULL,
    delivery_start TEXT NOT NULL,
    delivery_end TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, user_id)
      REFERENCES workspace_members(workspace_id, user_id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS sessions_user_expires_idx
    ON sessions(user_id, expires_at);

  CREATE TABLE IF NOT EXISTS audit_events (
    id BIGSERIAL PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    payload_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS audit_events_workspace_created_idx
    ON audit_events(workspace_id, created_at);
`;

const postgresAuthRateLimitSchema = `
  CREATE TABLE auth_rate_limits (
    rate_key TEXT PRIMARY KEY,
    attempt_count INTEGER NOT NULL CHECK(attempt_count >= 1),
    expires_at TIMESTAMPTZ NOT NULL,
    revision TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  );

  CREATE INDEX auth_rate_limits_expires_idx
    ON auth_rate_limits(expires_at);
`;

const postgresOnboardingSchema = `
  CREATE TABLE workspace_onboarding (
    workspace_id TEXT PRIMARY KEY,
    target_role TEXT NOT NULL,
    target_city TEXT NOT NULL,
    search_stage TEXT NOT NULL,
    current_opportunity_count INTEGER NOT NULL CHECK(current_opportunity_count >= 0),
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL,
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

  INSERT INTO workspace_onboarding(
    workspace_id, target_role, target_city, search_stage,
    current_opportunity_count, completed_at, updated_at
  )
  SELECT workspaces.id, '', '', 'actively_applying', 0, NULL, workspaces.created_at
  FROM workspaces
  WHERE EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_members.workspace_id = workspaces.id
  )
  ON CONFLICT(workspace_id) DO NOTHING;

  INSERT INTO audit_events(
    workspace_id, event_type, entity_type, entity_id, payload_json, created_at
  )
  SELECT
    workspaces.id, 'activation.account_registered', 'workspace',
    workspaces.id, '{}'::jsonb, workspaces.created_at
  FROM workspaces
  WHERE EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_members.workspace_id = workspaces.id
  )
  ON CONFLICT DO NOTHING;

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

  INSERT INTO audit_events(
    workspace_id, event_type, entity_type, entity_id, payload_json, created_at
  )
  SELECT
    workspaces.id, 'activation.first_opportunity_added', 'opportunity',
    first_opportunity.id, '{}'::jsonb, workspaces.created_at
  FROM workspaces
  CROSS JOIN LATERAL (
    SELECT opportunities.id FROM opportunities
    WHERE opportunities.workspace_id = workspaces.id
    ORDER BY opportunities.created_at, opportunities.id LIMIT 1
  ) AS first_opportunity
  WHERE EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_members.workspace_id = workspaces.id
  )
  ON CONFLICT DO NOTHING;

  INSERT INTO audit_events(
    workspace_id, event_type, entity_type, entity_id, payload_json, created_at
  )
  SELECT
    workspaces.id, 'activation.first_follow_up_generated', 'follow_up',
    first_follow_up.id, '{}'::jsonb, workspaces.created_at
  FROM workspaces
  CROSS JOIN LATERAL (
    SELECT follow_up_tasks.id FROM follow_up_tasks
    WHERE follow_up_tasks.workspace_id = workspaces.id
    ORDER BY follow_up_tasks.created_at, follow_up_tasks.id LIMIT 1
  ) AS first_follow_up
  WHERE EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_members.workspace_id = workspaces.id
  )
  ON CONFLICT DO NOTHING;
`;

function toIsoString(value: unknown) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(String(value)).toISOString();
}

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
    lastActivityAt: toIsoString(row.last_activity_at),
    nextFollowUpAt: row.next_follow_up_at
      ? toIsoString(row.next_follow_up_at)
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
    dueAt: toIsoString(row.due_at),
    reason: String(row.reason),
    context: String(row.context),
    message: String(row.message),
    confidence: Number(row.confidence),
    status: String(row.status) as FollowUpTask["status"],
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
    completedAt: row.completed_at ? toIsoString(row.completed_at) : null,
  };
}

function isDuplicateEmail(error: unknown) {
  if (!(error instanceof Error)) return false;
  const databaseError = error as Error & { code?: string; constraint?: string };
  return (
    databaseError.code === "23505" &&
    (databaseError.constraint === "users_email_lower_idx" ||
      databaseError.message.includes("users_email_lower_idx"))
  );
}

class PoolProvider implements PostgresProvider {
  constructor(private readonly pool: Pool) {}

  async query(text: string, values?: unknown[]) {
    const result = await this.pool.query(text, values);
    return { rows: result.rows as DatabaseRow[], rowCount: result.rowCount };
  }

  async connect() {
    const client = await this.pool.connect();
    return wrapPoolClient(client);
  }
}

function wrapPoolClient(client: PoolClient): PostgresTransactionConnection {
  return {
    async query(text: string, values?: unknown[]) {
      const result = await client.query(text, values);
      return { rows: result.rows as DatabaseRow[], rowCount: result.rowCount };
    },
    release() {
      client.release();
    },
  };
}

export class PostgresFollowUpStore implements FollowUpStore {
  readonly backend = "postgres" as const;

  private constructor(private readonly provider: PostgresProvider) {}

  static async create(provider: PostgresProvider) {
    const repository = new PostgresFollowUpStore(provider);
    await repository.migrate();
    return repository;
  }

  private async migrate() {
    await this.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(20260811)");
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL
        )
      `);
      const applied = await client.query("SELECT version FROM schema_migrations");
      const appliedVersions = new Set(applied.rows.map((row) => Number(row.version)));
      const migrations = [
        [1, postgresSchema],
        [2, postgresAuthRateLimitSchema],
        [3, postgresOnboardingSchema],
      ] as const;
      for (const [version, statements] of migrations) {
        if (appliedVersions.has(version)) continue;
        await client.query(statements);
        await client.query(
          `INSERT INTO schema_migrations(version, applied_at) VALUES($1, $2)
           ON CONFLICT(version) DO NOTHING`,
          [version, new Date().toISOString()],
        );
      }
    });
  }

  async checkHealth() {
    await this.provider.query("SELECT 1");
  }

  async createAccount(
    input: { email: string; displayName: string; passwordHash: string },
    now = new Date(),
  ): Promise<AccountIdentity> {
    const email = input.email.trim().toLowerCase();
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const timestamp = now.toISOString();

    try {
      await this.transaction(async (client) => {
        await client.query(
          `INSERT INTO users(
            id, email, display_name, password_hash, created_at, updated_at
          ) VALUES($1, $2, $3, $4, $5, $5)`,
          [userId, email, input.displayName, input.passwordHash, timestamp],
        );
        await client.query(
          "INSERT INTO workspaces(id, display_name, created_at) VALUES($1, $2, $3)",
          [workspaceId, `${input.displayName}的求职计划`, timestamp],
        );
        await client.query(
          `INSERT INTO workspace_members(workspace_id, user_id, role, created_at)
           VALUES($1, $2, 'owner', $3)`,
          [workspaceId, userId, timestamp],
        );
        await this.initializeAccountWorkspace(client, workspaceId, timestamp);
      });
    } catch (error) {
      if (isDuplicateEmail(error)) {
        throw new RepositoryConflictError("Email already exists");
      }
      throw error;
    }

    return {
      user: { id: userId, email, displayName: input.displayName },
      workspaceId,
    };
  }

  async findUserByEmail(email: string): Promise<PasswordUserRecord | null> {
    const result = await this.provider.query(
      `SELECT
        users.id, users.email, users.display_name, users.password_hash,
        workspace_members.workspace_id
       FROM users
       JOIN workspace_members ON workspace_members.user_id = users.id
       WHERE lower(users.email) = lower($1)
       ORDER BY workspace_members.created_at ASC
       LIMIT 1`,
      [email.trim()],
    );
    const row = result.rows[0];
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

  async createSession(
    identity: AccountIdentity,
    tokenHash: string,
    expiresAt: Date,
    now = new Date(),
  ) {
    await this.provider.query(
      `INSERT INTO sessions(
        token_hash, user_id, workspace_id, expires_at, created_at
      ) VALUES($1, $2, $3, $4, $5)`,
      [
        tokenHash,
        identity.user.id,
        identity.workspaceId,
        expiresAt.toISOString(),
        now.toISOString(),
      ],
    );
  }

  async getSession(
    tokenHash: string,
    now = new Date(),
  ): Promise<AuthenticatedSession | null> {
    const result = await this.provider.query(
      `SELECT
        users.id, users.email, users.display_name,
        sessions.workspace_id, sessions.expires_at
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       JOIN workspace_members
         ON workspace_members.user_id = sessions.user_id
        AND workspace_members.workspace_id = sessions.workspace_id
       WHERE sessions.token_hash = $1 AND sessions.expires_at > $2`,
      [tokenHash, now.toISOString()],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      user: {
        id: String(row.id),
        email: String(row.email),
        displayName: String(row.display_name),
      },
      workspaceId: String(row.workspace_id),
      expiresAt: toIsoString(row.expires_at),
    };
  }

  async deleteSession(tokenHash: string) {
    await this.provider.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
  }

  async consumeRateLimit(key: string, policy: RateLimitPolicy, now = new Date()) {
    const timestamp = now.toISOString();
    const nextExpiry = new Date(now.getTime() + policy.windowMs).toISOString();
    const revision = randomUUID();
    return this.transaction(async (client) => {
      await client.query(
        `WITH expired AS (
          SELECT rate_key FROM auth_rate_limits
          WHERE expires_at <= $1
          ORDER BY expires_at
          LIMIT 100
          FOR UPDATE SKIP LOCKED
        )
        DELETE FROM auth_rate_limits
        USING expired
        WHERE auth_rate_limits.rate_key = expired.rate_key`,
        [timestamp],
      );
      const result = await client.query(
        `INSERT INTO auth_rate_limits(
          rate_key, attempt_count, expires_at, revision, updated_at
        ) VALUES($1, 1, $2, $3, $4)
        ON CONFLICT(rate_key) DO UPDATE SET
          attempt_count = CASE
            WHEN auth_rate_limits.expires_at <= EXCLUDED.updated_at THEN 1
            ELSE auth_rate_limits.attempt_count + 1
          END,
          expires_at = CASE
            WHEN auth_rate_limits.expires_at <= EXCLUDED.updated_at
              THEN EXCLUDED.expires_at
            ELSE auth_rate_limits.expires_at
          END,
          revision = EXCLUDED.revision,
          updated_at = EXCLUDED.updated_at
        RETURNING attempt_count, expires_at, revision`,
        [key, nextExpiry, revision, timestamp],
      );
      const row = result.rows[0];
      return createRateLimitDecision(
        Number(row.attempt_count),
        new Date(toIsoString(row.expires_at)),
        policy.limit,
        now,
        String(row.revision),
      );
    });
  }

  async clearRateLimit(key: string, expectedRevision: string) {
    await this.provider.query(
      `DELETE FROM auth_rate_limits
       WHERE rate_key = $1 AND revision = $2`,
      [key, expectedRevision],
    );
  }

  async getWorkspace(workspaceId: string): Promise<WorkspaceSnapshot> {
    return this.transaction(
      async (client) => {
        const [workspace, opportunities, followUps, settings, onboarding] =
          await Promise.all([
          client.query("SELECT id FROM workspaces WHERE id = $1", [workspaceId]),
          client.query(
            `SELECT * FROM opportunities
             WHERE workspace_id = $1 ORDER BY created_at DESC, id ASC`,
            [workspaceId],
          ),
          client.query(
            `SELECT * FROM follow_up_tasks
             WHERE workspace_id = $1 ORDER BY due_at ASC, id ASC`,
            [workspaceId],
          ),
          client.query(
            "SELECT * FROM candidate_settings WHERE workspace_id = $1",
            [workspaceId],
          ),
          client.query(
            "SELECT * FROM workspace_onboarding WHERE workspace_id = $1",
            [workspaceId],
          ),
        ]);
        if (workspace.rows.length === 0) {
          throw new RepositoryNotFoundError("Workspace not found");
        }
        return {
          opportunities: opportunities.rows.map(mapOpportunity),
          followUps: followUps.rows.map(mapFollowUp),
          settings: settings.rows[0]
            ? mapSettings(settings.rows[0])
            : defaultCandidateSettings,
          onboarding: mapOnboarding(onboarding.rows[0]),
          storage: "server" as const,
        };
      },
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
  }

  async createOpportunity(
    workspaceId: string,
    input: NewOpportunityInput,
    now = new Date(),
  ) {
    const prepared = prepareNewOpportunity(input, now);
    if (!prepared) {
      throw new RepositoryConflictError("A follow-up could not be scheduled");
    }
    const timestamp = now.toISOString();
    await this.transaction(async (client) => {
      await this.requireWorkspace(client, workspaceId);
      const existing = await client.query(
        "SELECT id FROM opportunities WHERE workspace_id = $1 LIMIT 1",
        [workspaceId],
      );
      const isFirstOpportunity = existing.rows.length === 0;
      await this.insertOpportunity(
        client,
        workspaceId,
        prepared.opportunity,
        timestamp,
      );
      await this.insertFollowUp(
        client,
        workspaceId,
        prepared.followUp,
        timestamp,
      );
      await this.audit(
        client,
        workspaceId,
        "opportunity.created",
        "opportunity",
        prepared.opportunity.id,
        { source: prepared.opportunity.source, stage: prepared.opportunity.stage },
        timestamp,
      );
      if (isFirstOpportunity) {
        await this.auditOnce(
          client,
          workspaceId,
          "activation.first_opportunity_added",
          "opportunity",
          prepared.opportunity.id,
          {},
          timestamp,
        );
        await this.auditOnce(
          client,
          workspaceId,
          "activation.first_follow_up_generated",
          "follow_up",
          prepared.followUp.id,
          {},
          timestamp,
        );
      }
    });
    return prepared;
  }

  async updateFollowUp(
    workspaceId: string,
    taskId: string,
    mutation: FollowUpMutation,
    now = new Date(),
  ) {
    return this.transaction(async (client) => {
      const selected = await client.query(
        `SELECT * FROM follow_up_tasks
         WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
        [taskId, workspaceId],
      );
      const row = selected.rows[0];
      if (!row) throw new RepositoryNotFoundError("Follow-up not found");
      const current = mapFollowUp(row);
      if (mutation.action === "mark_sent" && current.status === "sent") {
        return current;
      }
      if (current.status === "sent" || current.status === "skipped") {
        throw new RepositoryConflictError("Follow-up is already final");
      }

      const timestamp = now.toISOString();
      const { followUp, eventType, nextFollowUpAt, sentAt } =
        prepareFollowUpUpdate(current, mutation, now);
      await client.query(
        `UPDATE follow_up_tasks
         SET status = $1, due_at = $2, message = $3, sent_at = $4, updated_at = $5
         WHERE id = $6 AND workspace_id = $7`,
        [
          followUp.status,
          followUp.dueAt,
          followUp.message,
          sentAt,
          timestamp,
          taskId,
          workspaceId,
        ],
      );
      await client.query(
        `UPDATE opportunities
         SET next_follow_up_at = $1, updated_at = $2
         WHERE id = $3 AND workspace_id = $4`,
        [nextFollowUpAt, timestamp, current.opportunityId, workspaceId],
      );
      await this.audit(
        client,
        workspaceId,
        eventType,
        "follow_up",
        taskId,
        { status: followUp.status, dueAt: followUp.dueAt },
        timestamp,
      );
      const registeredAccount = await client.query(
        `SELECT 1 FROM audit_events
         WHERE workspace_id = $1 AND event_type = 'activation.account_registered'`,
        [workspaceId],
      );
      if (
        mutation.action === "mark_sent" &&
        registeredAccount.rows.length > 0
      ) {
        await this.auditOnce(
          client,
          workspaceId,
          "activation.first_follow_up_confirmed",
          "follow_up",
          taskId,
          {},
          timestamp,
        );
      }
      return followUp;
    });
  }

  async updateSettings(
    workspaceId: string,
    settings: CandidateSettings,
    now = new Date(),
  ) {
    const timestamp = now.toISOString();
    await this.transaction(async (client) => {
      await this.requireWorkspace(client, workspaceId);
      await this.writeSettings(client, workspaceId, settings, timestamp);
      await this.audit(
        client,
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

  async completeOnboarding(
    workspaceId: string,
    input: OnboardingInput,
    now = new Date(),
  ) {
    const timestamp = now.toISOString();
    return this.transaction(async (client) => {
      await this.requireWorkspace(client, workspaceId);
      const [onboardingResult, settingsResult] = await Promise.all([
        client.query(
          "SELECT completed_at FROM workspace_onboarding WHERE workspace_id = $1 FOR UPDATE",
          [workspaceId],
        ),
        client.query(
          "SELECT * FROM candidate_settings WHERE workspace_id = $1",
          [workspaceId],
        ),
      ]);
      const completedAt = onboardingResult.rows[0]?.completed_at
        ? toIsoString(onboardingResult.rows[0].completed_at)
        : timestamp;
      const settings = {
        ...(settingsResult.rows[0]
          ? mapSettings(settingsResult.rows[0])
          : defaultCandidateSettings),
        targetRoles: input.targetRole,
        targetCities: input.targetCity,
      };
      await client.query(
        `INSERT INTO workspace_onboarding(
          workspace_id, target_role, target_city, search_stage,
          current_opportunity_count, completed_at, updated_at
        ) VALUES($1, $2, $3, $4, $5, $6, $6)
        ON CONFLICT(workspace_id) DO UPDATE SET
          target_role = EXCLUDED.target_role,
          target_city = EXCLUDED.target_city,
          search_stage = EXCLUDED.search_stage,
          current_opportunity_count = EXCLUDED.current_opportunity_count,
          completed_at = COALESCE(workspace_onboarding.completed_at, EXCLUDED.completed_at),
          updated_at = EXCLUDED.updated_at`,
        [
          workspaceId,
          input.targetRole,
          input.targetCity,
          input.searchStage,
          input.currentOpportunityCount,
          timestamp,
        ],
      );
      await this.writeSettings(client, workspaceId, settings, timestamp);
      await this.auditOnce(
        client,
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
      return {
        onboarding: { ...input, completedAt },
        settings,
      };
    });
  }

  private async initializeAccountWorkspace(
    client: PostgresConnection,
    workspaceId: string,
    timestamp: string,
  ) {
    await this.writeSettings(
      client,
      workspaceId,
      defaultCandidateSettings,
      timestamp,
    );
    await client.query(
      `INSERT INTO workspace_onboarding(
        workspace_id, target_role, target_city, search_stage,
        current_opportunity_count, completed_at, updated_at
      ) VALUES($1, '', '', 'actively_applying', 0, NULL, $2)`,
      [workspaceId, timestamp],
    );
    await this.auditOnce(
      client,
      workspaceId,
      "activation.account_registered",
      "workspace",
      workspaceId,
      {},
      timestamp,
    );
  }

  private async insertOpportunity(
    client: PostgresConnection,
    workspaceId: string,
    opportunity: Opportunity,
    timestamp: string,
  ) {
    await client.query(
      `INSERT INTO opportunities(
        id, workspace_id, company, company_mark, role, location, salary,
        recruiter, source, stage, stage_label, priority, last_activity_at,
        next_follow_up_at, resume, created_at, updated_at
      ) VALUES(
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        $15, $16, $16
      )`,
      [
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
      ],
    );
  }

  private async insertFollowUp(
    client: PostgresConnection,
    workspaceId: string,
    followUp: FollowUpTask,
    timestamp: string,
  ) {
    await client.query(
      `INSERT INTO follow_up_tasks(
        id, workspace_id, opportunity_id, company, company_mark, role,
        recruiter, channel, stage, due_at, reason, context, message,
        confidence, status, created_at, updated_at
      ) VALUES(
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        $15, $16, $16
      )`,
      [
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
      ],
    );
  }

  private async writeSettings(
    client: PostgresConnection,
    workspaceId: string,
    settings: CandidateSettings,
    timestamp: string,
  ) {
    await client.query(
      `INSERT INTO candidate_settings(
        workspace_id, target_roles, target_cities, minimum_monthly_salary,
        exclusions, confirm_before_send, avoid_weekends, max_follow_ups,
        delivery_start, delivery_end, updated_at
      ) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT(workspace_id) DO UPDATE SET
        target_roles = EXCLUDED.target_roles,
        target_cities = EXCLUDED.target_cities,
        minimum_monthly_salary = EXCLUDED.minimum_monthly_salary,
        exclusions = EXCLUDED.exclusions,
        confirm_before_send = EXCLUDED.confirm_before_send,
        avoid_weekends = EXCLUDED.avoid_weekends,
        max_follow_ups = EXCLUDED.max_follow_ups,
        delivery_start = EXCLUDED.delivery_start,
        delivery_end = EXCLUDED.delivery_end,
        updated_at = EXCLUDED.updated_at`,
      [
        workspaceId,
        settings.targetRoles,
        settings.targetCities,
        settings.minimumMonthlySalary,
        settings.exclusions,
        settings.confirmBeforeSend,
        settings.avoidWeekends,
        settings.maxFollowUps,
        settings.deliveryStart,
        settings.deliveryEnd,
        timestamp,
      ],
    );
  }

  private async audit(
    client: PostgresConnection,
    workspaceId: string,
    eventType: string,
    entityType: string,
    entityId: string,
    payload: object,
    timestamp: string,
  ) {
    await client.query(
      `INSERT INTO audit_events(
        workspace_id, event_type, entity_type, entity_id, payload_json, created_at
      ) VALUES($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        workspaceId,
        eventType,
        entityType,
        entityId,
        JSON.stringify(payload),
        timestamp,
      ],
    );
  }

  private async auditOnce(
    client: PostgresConnection,
    workspaceId: string,
    eventType: string,
    entityType: string,
    entityId: string,
    payload: object,
    timestamp: string,
  ) {
    await client.query(
      `INSERT INTO audit_events(
        workspace_id, event_type, entity_type, entity_id, payload_json, created_at
      ) VALUES($1, $2, $3, $4, $5::jsonb, $6)
      ON CONFLICT DO NOTHING`,
      [
        workspaceId,
        eventType,
        entityType,
        entityId,
        JSON.stringify(payload),
        timestamp,
      ],
    );
  }

  private async requireWorkspace(
    client: PostgresConnection,
    workspaceId: string,
  ) {
    const result = await client.query("SELECT id FROM workspaces WHERE id = $1", [
      workspaceId,
    ]);
    if (result.rows.length === 0) {
      throw new RepositoryNotFoundError("Workspace not found");
    }
  }

  private async transaction<T>(
    operation: (client: PostgresConnection) => Promise<T>,
    beginStatement = "BEGIN",
  ): Promise<T> {
    const client = await this.provider.connect();
    let transactionStarted = false;
    try {
      await client.query(beginStatement);
      transactionStarted = true;
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      if (transactionStarted) {
        // A failed rollback must not hide the operation or commit failure.
        await client.query("ROLLBACK").catch(() => undefined);
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function createPostgresFollowUpStore(connectionString: string) {
  const pool = new Pool({
    connectionString,
    application_name: "career-followup-agent",
  });
  try {
    return await PostgresFollowUpStore.create(new PoolProvider(pool));
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
}
