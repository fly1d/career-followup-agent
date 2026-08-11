import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { addBusinessDays, set } from "date-fns";
import {
  createDemoData,
  type FollowUpStatus,
  type FollowUpTask,
  type Opportunity,
} from "@/data/demo";
import {
  buildFollowUpDraft,
  recommendFollowUp,
  type OpportunityStage,
} from "@/domain/follow-up";
import {
  defaultCandidateSettings,
  type CandidateSettings,
} from "@/domain/settings";

export const DEMO_WORKSPACE_ID = "demo-workspace";

type DatabaseRow = Record<string, unknown>;

export interface WorkspaceSnapshot {
  followUps: FollowUpTask[];
  opportunities: Opportunity[];
  settings: CandidateSettings;
  storage: "server";
}

export interface NewOpportunityInput {
  company: string;
  role: string;
  location: string;
  salary: string;
}

export type FollowUpMutation =
  | { action: "mark_sent"; message: string }
  | { action: "snooze" }
  | { action: "skip" };

export class RepositoryNotFoundError extends Error {}
export class RepositoryConflictError extends Error {}

const schema = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );

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

export class FollowUpRepository {
  constructor(private readonly database: DatabaseSync) {
    this.database.exec("PRAGMA foreign_keys = ON;");
    this.database.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate() {
    this.database.exec(schema);
    const applied = this.database
      .prepare("SELECT version FROM schema_migrations WHERE version = 1")
      .get();
    if (!applied) {
      this.database
        .prepare(
          "INSERT INTO schema_migrations(version, applied_at) VALUES(1, ?)",
        )
        .run(new Date().toISOString());
    }
  }

  seedDemoWorkspace(now = new Date()) {
    const exists = this.database
      .prepare("SELECT id FROM workspaces WHERE id = ?")
      .get(DEMO_WORKSPACE_ID);
    if (exists) return;

    const { followUps, opportunities } = createDemoData(now);
    const timestamp = now.toISOString();

    this.transaction(() => {
      this.database
        .prepare(
          "INSERT INTO workspaces(id, display_name, created_at) VALUES(?, ?, ?)",
        )
        .run(DEMO_WORKSPACE_ID, "我的求职计划", timestamp);

      for (const opportunity of opportunities) {
        this.insertOpportunity(DEMO_WORKSPACE_ID, opportunity, timestamp);
      }
      for (const followUp of followUps) {
        this.insertFollowUp(DEMO_WORKSPACE_ID, followUp, timestamp);
      }
      this.writeSettings(DEMO_WORKSPACE_ID, defaultCandidateSettings, timestamp);
      this.audit(
        DEMO_WORKSPACE_ID,
        "workspace.seeded",
        "workspace",
        DEMO_WORKSPACE_ID,
        { opportunities: opportunities.length, followUps: followUps.length },
        timestamp,
      );
    });
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

    return {
      opportunities,
      followUps,
      settings: settingsRow
        ? mapSettings(settingsRow)
        : defaultCandidateSettings,
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
    const opportunityId = randomUUID();
    const recommendation = recommendFollowUp({
      stage: "applied",
      lastActivityAt: now,
      priorFollowUpCount: 0,
    });

    if (!recommendation) {
      throw new RepositoryConflictError("A follow-up could not be scheduled");
    }

    const opportunity: Opportunity = {
      id: opportunityId,
      company: input.company,
      companyMark: input.company.slice(0, 1),
      role: input.role,
      location: input.location || "待确认",
      salary: input.salary || "待确认",
      recruiter: "待补充",
      source: "手动添加",
      stage: "applied",
      stageLabel: "已投递",
      priority: "normal",
      lastActivityAt: timestamp,
      nextFollowUpAt: recommendation.dueAt.toISOString(),
      resume: "待选择简历",
    };
    const followUp: FollowUpTask = {
      id: randomUUID(),
      opportunityId,
      company: input.company,
      companyMark: input.company.slice(0, 1),
      role: input.role,
      recruiter: "待补充",
      channel: "手动添加",
      stage: "applied",
      dueAt: recommendation.dueAt.toISOString(),
      reason: recommendation.reason,
      context: "机会由用户手动添加，等待补充招聘方与沟通信息。",
      message: buildFollowUpDraft({
        role: input.role,
        company: input.company,
        stage: "applied",
      }),
      confidence: 78,
      status: "scheduled",
    };

    this.transaction(() => {
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
    let status: FollowUpStatus = current.status;
    let dueAt = current.dueAt;
    let message = current.message;
    let eventType: string;

    if (mutation.action === "mark_sent") {
      status = "sent";
      message = mutation.message;
      eventType = "follow_up.sent_recorded";
    } else if (mutation.action === "snooze") {
      status = "scheduled";
      const nextDay = set(addBusinessDays(now, 1), {
        hours: 10,
        minutes: 0,
        seconds: 0,
        milliseconds: 0,
      });
      dueAt = nextDay.toISOString();
      eventType = "follow_up.snoozed";
    } else {
      status = "skipped";
      eventType = "follow_up.skipped";
    }

    this.transaction(() => {
      this.database
        .prepare(
          `UPDATE follow_up_tasks
           SET status = ?, due_at = ?, message = ?, sent_at = ?, updated_at = ?
           WHERE id = ? AND workspace_id = ?`,
        )
        .run(
          status,
          dueAt,
          message,
          status === "sent" ? timestamp : null,
          timestamp,
          taskId,
          workspaceId,
        );
      this.database
        .prepare(
          "UPDATE opportunities SET next_follow_up_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?",
        )
        .run(
          status === "scheduled" ? dueAt : null,
          timestamp,
          current.opportunityId,
          workspaceId,
        );
      this.audit(workspaceId, eventType, "follow_up", taskId, { status, dueAt }, timestamp);
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

  countAuditEvents(workspaceId: string) {
    const row = this.database
      .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE workspace_id = ?")
      .get(workspaceId) as { count: number };
    return Number(row.count);
  }

  close() {
    this.database.close();
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
