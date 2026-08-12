import type { FollowUpTask, Opportunity } from "@/data/demo";
import type { CandidateSettings } from "@/domain/settings";
import type { OnboardingInput, OnboardingProfile } from "@/domain/onboarding";
import type {
  PilotEnrollment,
  PilotOperationsSnapshot,
  PilotRequestInput,
} from "@/domain/pilot";

export interface WorkspaceSnapshot {
  followUps: FollowUpTask[];
  opportunities: Opportunity[];
  settings: CandidateSettings;
  onboarding: OnboardingProfile;
  pilot: PilotEnrollment;
  storage: "server";
}

export interface NewOpportunityDraft {
  company: string;
  role: string;
  location: string;
  salary: string;
}

export interface AccountUser {
  email: string;
  displayName: string;
}

interface ApiErrorBody {
  error?: { message?: string };
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  const body = (await response.json()) as unknown;
  if (!response.ok) {
    const errorBody =
      typeof body === "object" && body !== null
        ? (body as ApiErrorBody)
        : undefined;
    const message = errorBody?.error?.message ?? "服务器暂时无法完成请求。";
    throw new Error(message);
  }
  return body as T;
}

export function fetchWorkspace() {
  return requestJson<WorkspaceSnapshot>("/api/workspace");
}

export function mutateFollowUp(
  taskId: string,
  mutation:
    | { action: "mark_sent"; message: string }
    | { action: "snooze" }
    | { action: "skip" },
) {
  return requestJson<{ followUp: FollowUpTask }>(
    `/api/follow-ups/${encodeURIComponent(taskId)}`,
    { method: "PATCH", body: JSON.stringify(mutation) },
  );
}

export function createOpportunity(input: NewOpportunityDraft) {
  return requestJson<{ opportunity: Opportunity; followUp: FollowUpTask }>(
    "/api/opportunities",
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function saveCandidateSettings(settings: CandidateSettings) {
  return requestJson<{ settings: CandidateSettings }>("/api/settings", {
    method: "PATCH",
    body: JSON.stringify(settings),
  });
}

export function completeOnboarding(input: OnboardingInput) {
  return requestJson<{
    onboarding: OnboardingProfile;
    settings: CandidateSettings;
  }>("/api/onboarding", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function requestPilotEnrollment(input: PilotRequestInput) {
  return requestJson<{ pilot: PilotEnrollment }>("/api/pilot", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function confirmPilotPayment(orderId: string) {
  return requestJson<PilotOperationsSnapshot>(
    `/api/admin/pilot/${encodeURIComponent(orderId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ action: "confirm_payment" }),
    },
  );
}

export function authenticateAccount(
  mode: "login" | "register",
  input: { email: string; password: string; displayName?: string },
) {
  return requestJson<{ user: AccountUser; expiresAt: string }>(
    `/api/auth/${mode}`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function logoutAccount() {
  return requestJson<{ success: true }>("/api/auth/logout", { method: "POST" });
}
