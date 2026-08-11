import { addDays, addHours, subDays, subHours } from "date-fns";
import type { OpportunityStage } from "@/domain/follow-up";

export type FollowUpStatus = "pending" | "scheduled" | "sent" | "skipped";

export interface FollowUpTask {
  id: string;
  opportunityId: string;
  company: string;
  companyMark: string;
  role: string;
  recruiter: string;
  channel: string;
  stage: OpportunityStage;
  dueAt: string;
  reason: string;
  context: string;
  message: string;
  confidence: number;
  status: FollowUpStatus;
}

export interface Opportunity {
  id: string;
  company: string;
  companyMark: string;
  role: string;
  location: string;
  salary: string;
  recruiter: string;
  source: string;
  stage: OpportunityStage;
  stageLabel: string;
  priority: "high" | "normal";
  lastActivityAt: string;
  nextFollowUpAt?: string;
  resume: string;
}

export function createDemoData(now = new Date()) {
  const followUps: FollowUpTask[] = [
    {
      id: "follow-up-1",
      opportunityId: "opportunity-1",
      company: "澄屿科技",
      companyMark: "澄",
      role: "高级产品经理",
      recruiter: "王女士",
      channel: "BOSS 直聘",
      stage: "interview_completed",
      dueAt: subHours(now, 1).toISOString(),
      reason: "对方承诺本周一反馈，目前已超过约定时间。",
      context: "上周三完成二面，对方表示本周一前同步内部讨论结果。",
      message:
        "王女士您好，感谢此前关于澄屿科技高级产品经理岗位的交流。我对岗位和团队的工作方向仍然很感兴趣，想了解一下目前招聘流程是否有新的进展。如需我补充任何材料，我可以随时提供。",
      confidence: 96,
      status: "pending",
    },
    {
      id: "follow-up-2",
      opportunityId: "opportunity-2",
      company: "未序智能",
      companyMark: "未",
      role: "AI 产品经理",
      recruiter: "陈先生",
      channel: "招聘邮箱",
      stage: "resume_viewed",
      dueAt: addHours(now, 2).toISOString(),
      reason: "招聘方两天前查看了简历，尚未开始沟通。",
      context: "岗位匹配度较高，简历强调了智能工作流和企业产品经验。",
      message:
        "陈先生您好，此前向未序智能投递了 AI 产品经理岗位，我对这个机会仍然很感兴趣，想礼貌了解一下目前的招聘进展。如需补充信息，我可以随时提供。感谢您的时间。",
      confidence: 91,
      status: "pending",
    },
    {
      id: "follow-up-3",
      opportunityId: "opportunity-3",
      company: "北岸数据",
      companyMark: "北",
      role: "产品运营负责人",
      recruiter: "刘女士",
      channel: "LinkedIn",
      stage: "material_submitted",
      dueAt: addDays(now, 1).toISOString(),
      reason: "补充案例已发送，将在满两个工作日后确认接收情况。",
      context: "昨天按要求补充了增长实验案例和英文简历。",
      message:
        "刘女士您好，此前应聘北岸数据产品运营负责人岗位时，我已按要求补充了相关材料。想确认您是否顺利收到，也想了解一下后续流程安排。感谢您的时间。",
      confidence: 94,
      status: "scheduled",
    },
  ];

  const opportunities: Opportunity[] = [
    {
      id: "opportunity-1",
      company: "澄屿科技",
      companyMark: "澄",
      role: "高级产品经理",
      location: "上海",
      salary: "30-45K",
      recruiter: "王女士",
      source: "BOSS 直聘",
      stage: "interview_completed",
      stageLabel: "二面完成",
      priority: "high",
      lastActivityAt: subDays(now, 6).toISOString(),
      nextFollowUpAt: followUps[0].dueAt,
      resume: "产品经理-增长方向-v4.pdf",
    },
    {
      id: "opportunity-2",
      company: "未序智能",
      companyMark: "未",
      role: "AI 产品经理",
      location: "杭州",
      salary: "28-40K",
      recruiter: "陈先生",
      source: "招聘邮箱",
      stage: "resume_viewed",
      stageLabel: "已查看简历",
      priority: "high",
      lastActivityAt: subDays(now, 2).toISOString(),
      nextFollowUpAt: followUps[1].dueAt,
      resume: "AI产品经理-定制版-v2.pdf",
    },
    {
      id: "opportunity-3",
      company: "北岸数据",
      companyMark: "北",
      role: "产品运营负责人",
      location: "上海",
      salary: "25-35K",
      recruiter: "刘女士",
      source: "LinkedIn",
      stage: "material_submitted",
      stageLabel: "已补充材料",
      priority: "normal",
      lastActivityAt: subDays(now, 1).toISOString(),
      nextFollowUpAt: followUps[2].dueAt,
      resume: "产品运营-通用版-v3.pdf",
    },
    {
      id: "opportunity-4",
      company: "砺行网络",
      companyMark: "砺",
      role: "商业化产品经理",
      location: "深圳",
      salary: "30-50K",
      recruiter: "赵先生",
      source: "猎聘",
      stage: "interview_scheduled",
      stageLabel: "面试已安排",
      priority: "normal",
      lastActivityAt: subHours(now, 5).toISOString(),
      resume: "商业化产品-定制版-v1.pdf",
    },
  ];

  return { followUps, opportunities };
}
