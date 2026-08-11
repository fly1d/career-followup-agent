import { randomUUID } from "node:crypto";
import { addBusinessDays, set } from "date-fns";
import {
  createDemoData,
  type FollowUpStatus,
  type FollowUpTask,
  type Opportunity,
} from "@/data/demo";
import { buildFollowUpDraft, recommendFollowUp } from "@/domain/follow-up";
import type { FollowUpMutation, NewOpportunityInput } from "./repository";

export function createWorkspaceSeed(now: Date, regenerateIds: boolean) {
  const { followUps, opportunities } = createDemoData(now);
  const opportunityIds = new Map<string, string>();
  const seededOpportunities = opportunities.map((opportunity) => {
    const id = regenerateIds ? randomUUID() : opportunity.id;
    opportunityIds.set(opportunity.id, id);
    return { ...opportunity, id };
  });
  const seededFollowUps = followUps.map((followUp) => ({
    ...followUp,
    id: regenerateIds ? randomUUID() : followUp.id,
    opportunityId:
      opportunityIds.get(followUp.opportunityId) ?? followUp.opportunityId,
  }));
  return { opportunities: seededOpportunities, followUps: seededFollowUps };
}

export function prepareNewOpportunity(input: NewOpportunityInput, now: Date) {
  const opportunityId = randomUUID();
  const recommendation = recommendFollowUp({
    stage: "applied",
    lastActivityAt: now,
    priorFollowUpCount: 0,
  });
  if (!recommendation) return null;

  const timestamp = now.toISOString();
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
  return { opportunity, followUp };
}

export function prepareFollowUpUpdate(
  current: FollowUpTask,
  mutation: FollowUpMutation,
  now: Date,
) {
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
    dueAt = set(addBusinessDays(now, 1), {
      hours: 10,
      minutes: 0,
      seconds: 0,
      milliseconds: 0,
    }).toISOString();
    eventType = "follow_up.snoozed";
  } else {
    status = "skipped";
    eventType = "follow_up.skipped";
  }

  return {
    followUp: { ...current, status, dueAt, message },
    eventType,
    nextFollowUpAt: status === "scheduled" ? dueAt : null,
    sentAt: status === "sent" ? now.toISOString() : null,
  };
}
