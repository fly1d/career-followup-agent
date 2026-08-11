import { addBusinessDays, set } from "date-fns";

export type OpportunityStage =
  | "applied"
  | "resume_viewed"
  | "recruiter_chat"
  | "interview_scheduled"
  | "interview_completed"
  | "material_submitted"
  | "offer"
  | "rejected"
  | "closed";

export type FollowUpUrgency = "normal" | "attention" | "high";

export interface FollowUpInput {
  stage: OpportunityStage;
  lastActivityAt: Date;
  promisedResponseBy?: Date;
  priorFollowUpCount: number;
  recruiterReplied?: boolean;
}

export interface FollowUpRecommendation {
  dueAt: Date;
  reason: string;
  rule: "promised-date" | "stage-default" | "final-follow-up";
  urgency: FollowUpUrgency;
}

const stageRules: Partial<
  Record<OpportunityStage, { businessDays: number; reason: string }>
> = {
  applied: {
    businessDays: 3,
    reason: "投递后已等待 3 个工作日，可以礼貌确认简历进度。",
  },
  resume_viewed: {
    businessDays: 2,
    reason: "招聘方已查看简历但尚未回复，可以补充表达岗位意愿。",
  },
  recruiter_chat: {
    businessDays: 2,
    reason: "上次招聘沟通后暂未收到新消息，可以确认下一步安排。",
  },
  interview_completed: {
    businessDays: 3,
    reason: "面试结束后已等待 3 个工作日，可以询问流程进展。",
  },
  material_submitted: {
    businessDays: 2,
    reason: "补充材料已发送，可以确认对方是否收到并询问下一步。",
  },
  offer: {
    businessDays: 2,
    reason: "Offer 沟通暂未更新，可以确认审批或发放进度。",
  },
};

function atDeliveryHour(date: Date) {
  return set(date, { hours: 10, minutes: 0, seconds: 0, milliseconds: 0 });
}

function nextBusinessMorning(date: Date) {
  return atDeliveryHour(addBusinessDays(date, 1));
}

export function recommendFollowUp(
  input: FollowUpInput,
): FollowUpRecommendation | null {
  if (
    input.recruiterReplied ||
    input.priorFollowUpCount >= 2 ||
    input.stage === "rejected" ||
    input.stage === "closed" ||
    input.stage === "interview_scheduled"
  ) {
    return null;
  }

  if (input.promisedResponseBy) {
    return {
      dueAt: nextBusinessMorning(input.promisedResponseBy),
      reason: "招聘方承诺的反馈时间已结束，适合在下一个工作日跟进。",
      rule: "promised-date",
      urgency: "high",
    };
  }

  const rule = stageRules[input.stage];
  if (!rule) {
    return null;
  }

  const isFinalFollowUp = input.priorFollowUpCount === 1;
  const delay = isFinalFollowUp ? Math.max(rule.businessDays, 4) : rule.businessDays;

  return {
    dueAt: atDeliveryHour(addBusinessDays(input.lastActivityAt, delay)),
    reason: isFinalFollowUp
      ? "首次跟进后仍未收到回复。这是本次机会的最后一次主动追问。"
      : rule.reason,
    rule: isFinalFollowUp ? "final-follow-up" : "stage-default",
    urgency: isFinalFollowUp ? "attention" : "normal",
  };
}

interface MessageInput {
  recruiterName?: string;
  role: string;
  company: string;
  stage: OpportunityStage;
}

export function buildFollowUpDraft(input: MessageInput) {
  const salutation = input.recruiterName
    ? `${input.recruiterName}您好`
    : "您好";

  if (input.stage === "interview_completed") {
    return `${salutation}，感谢此前关于${input.company}${input.role}岗位的交流。我对岗位和团队的工作方向仍然很感兴趣，想了解一下目前招聘流程是否有新的进展。如需我补充任何材料，我可以随时提供。`;
  }

  if (input.stage === "material_submitted") {
    return `${salutation}，此前应聘${input.company}${input.role}岗位时，我已按要求补充了相关材料。想确认您是否顺利收到，也想了解一下后续流程安排。感谢您的时间。`;
  }

  return `${salutation}，此前向${input.company}投递了${input.role}岗位，我对这个机会仍然很感兴趣，想礼貌了解一下目前的招聘进展。如需补充信息，我可以随时提供。感谢您的时间。`;
}
