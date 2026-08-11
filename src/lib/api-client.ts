import type { FollowUpTask, Opportunity } from "@/data/demo";
import type { CandidateSettings } from "@/domain/settings";

export interface WorkspaceSnapshot {
  followUps: FollowUpTask[];
  opportunities: Opportunity[];
  settings: CandidateSettings;
  storage: "server";
}

export interface NewOpportunityDraft {
  company: string;
  role: string;
  location: string;
  salary: string;
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
