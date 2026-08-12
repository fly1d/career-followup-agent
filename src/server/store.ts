import {
  createFollowUpRepository,
  type AccountIdentity,
  type AuthenticatedSession,
  type FollowUpMutation,
  type FollowUpRepository,
  type NewOpportunityInput,
  type PasswordUserRecord,
  type WorkspaceSnapshot,
} from "./repository";
import type { CandidateSettings } from "@/domain/settings";
import type { OnboardingInput } from "@/domain/onboarding";
import type { RateLimitDecision, RateLimitPolicy } from "./rate-limit";

export interface FollowUpStore {
  readonly backend: "sqlite" | "postgres";
  checkHealth(): Promise<void>;
  createAccount(
    input: { email: string; displayName: string; passwordHash: string },
    now?: Date,
  ): Promise<AccountIdentity>;
  findUserByEmail(email: string): Promise<PasswordUserRecord | null>;
  createSession(
    identity: AccountIdentity,
    tokenHash: string,
    expiresAt: Date,
    now?: Date,
  ): Promise<void>;
  getSession(
    tokenHash: string,
    now?: Date,
  ): Promise<AuthenticatedSession | null>;
  deleteSession(tokenHash: string): Promise<void>;
  consumeRateLimit(
    key: string,
    policy: RateLimitPolicy,
    now?: Date,
  ): Promise<RateLimitDecision>;
  clearRateLimit(key: string, expectedRevision: string): Promise<void>;
  getWorkspace(workspaceId: string): Promise<WorkspaceSnapshot>;
  createOpportunity(
    workspaceId: string,
    input: NewOpportunityInput,
    now?: Date,
  ): Promise<ReturnType<FollowUpRepository["createOpportunity"]>>;
  updateFollowUp(
    workspaceId: string,
    taskId: string,
    mutation: FollowUpMutation,
    now?: Date,
  ): Promise<ReturnType<FollowUpRepository["updateFollowUp"]>>;
  updateSettings(
    workspaceId: string,
    settings: CandidateSettings,
    now?: Date,
  ): Promise<CandidateSettings>;
  completeOnboarding(
    workspaceId: string,
    input: OnboardingInput,
    now?: Date,
  ): Promise<ReturnType<FollowUpRepository["completeOnboarding"]>>;
}

class SqliteFollowUpStore implements FollowUpStore {
  readonly backend = "sqlite" as const;

  constructor(private readonly repository: FollowUpRepository) {}

  async checkHealth() {
    this.repository.checkHealth();
  }

  async createAccount(
    input: { email: string; displayName: string; passwordHash: string },
    now?: Date,
  ) {
    return this.repository.createAccount(input, now);
  }

  async findUserByEmail(email: string) {
    return this.repository.findUserByEmail(email);
  }

  async createSession(
    identity: AccountIdentity,
    tokenHash: string,
    expiresAt: Date,
    now?: Date,
  ) {
    this.repository.createSession(identity, tokenHash, expiresAt, now);
  }

  async getSession(tokenHash: string, now?: Date) {
    return this.repository.getSession(tokenHash, now);
  }

  async deleteSession(tokenHash: string) {
    this.repository.deleteSession(tokenHash);
  }

  async consumeRateLimit(key: string, policy: RateLimitPolicy, now?: Date) {
    return this.repository.consumeRateLimit(key, policy, now);
  }

  async clearRateLimit(key: string, expectedRevision: string) {
    this.repository.clearRateLimit(key, expectedRevision);
  }

  async getWorkspace(workspaceId: string) {
    return this.repository.getWorkspace(workspaceId);
  }

  async createOpportunity(
    workspaceId: string,
    input: NewOpportunityInput,
    now?: Date,
  ) {
    return this.repository.createOpportunity(workspaceId, input, now);
  }

  async updateFollowUp(
    workspaceId: string,
    taskId: string,
    mutation: FollowUpMutation,
    now?: Date,
  ) {
    return this.repository.updateFollowUp(workspaceId, taskId, mutation, now);
  }

  async updateSettings(
    workspaceId: string,
    settings: CandidateSettings,
    now?: Date,
  ) {
    return this.repository.updateSettings(workspaceId, settings, now);
  }

  async completeOnboarding(
    workspaceId: string,
    input: OnboardingInput,
    now?: Date,
  ) {
    return this.repository.completeOnboarding(workspaceId, input, now);
  }
}

export function createSqliteFollowUpStore(databasePath: string): FollowUpStore {
  return new SqliteFollowUpStore(createFollowUpRepository(databasePath));
}
