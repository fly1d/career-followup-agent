import { describe, expect, it } from "vitest";
import { buildFollowUpDraft, recommendFollowUp } from "./follow-up";

describe("recommendFollowUp", () => {
  it("schedules an application follow-up after three business days", () => {
    const result = recommendFollowUp({
      stage: "applied",
      lastActivityAt: new Date(2026, 7, 10, 15),
      priorFollowUpCount: 0,
    });

    expect(result?.dueAt).toEqual(new Date(2026, 7, 13, 10));
    expect(result?.rule).toBe("stage-default");
  });

  it("waits until the business day after a promised Friday", () => {
    const result = recommendFollowUp({
      stage: "interview_completed",
      lastActivityAt: new Date(2026, 7, 10, 15),
      promisedResponseBy: new Date(2026, 7, 14, 18),
      priorFollowUpCount: 0,
    });

    expect(result?.dueAt).toEqual(new Date(2026, 7, 17, 10));
    expect(result?.rule).toBe("promised-date");
  });

  it("stops after two proactive follow-ups", () => {
    const result = recommendFollowUp({
      stage: "applied",
      lastActivityAt: new Date(2026, 7, 10, 15),
      priorFollowUpCount: 2,
    });

    expect(result).toBeNull();
  });

  it("schedules the second attempt as the final follow-up", () => {
    const result = recommendFollowUp({
      stage: "resume_viewed",
      lastActivityAt: new Date(2026, 7, 10, 15),
      priorFollowUpCount: 1,
    });

    expect(result?.dueAt).toEqual(new Date(2026, 7, 14, 10));
    expect(result?.rule).toBe("final-follow-up");
    expect(result?.urgency).toBe("attention");
  });

  it.each(["rejected", "closed", "interview_scheduled"] as const)(
    "does not follow up while the opportunity is %s",
    (stage) => {
      expect(
        recommendFollowUp({
          stage,
          lastActivityAt: new Date(2026, 7, 10, 15),
          priorFollowUpCount: 0,
        }),
      ).toBeNull();
    },
  );

  it("cancels a pending recommendation when the recruiter replied", () => {
    expect(
      recommendFollowUp({
        stage: "recruiter_chat",
        lastActivityAt: new Date(2026, 7, 10, 15),
        priorFollowUpCount: 0,
        recruiterReplied: true,
      }),
    ).toBeNull();
  });

  it("fails closed for an unsupported stage received at runtime", () => {
    expect(
      recommendFollowUp({
        stage: "unexpected-stage" as never,
        lastActivityAt: new Date(2026, 7, 10, 15),
        priorFollowUpCount: 0,
      }),
    ).toBeNull();
  });
});

describe("buildFollowUpDraft", () => {
  it("uses known context without inventing candidate facts", () => {
    const draft = buildFollowUpDraft({
      recruiterName: "王女士",
      role: "高级产品经理",
      company: "澄屿科技",
      stage: "interview_completed",
    });

    expect(draft).toContain("王女士您好");
    expect(draft).toContain("澄屿科技高级产品经理");
    expect(draft).not.toMatch(/薪资|到岗|年经验/);
  });

  it("creates a material confirmation draft without a known recruiter name", () => {
    const draft = buildFollowUpDraft({
      role: "产品运营负责人",
      company: "北岸数据",
      stage: "material_submitted",
    });

    expect(draft).toContain("您好");
    expect(draft).toContain("确认您是否顺利收到");
  });

  it("creates a general application follow-up", () => {
    const draft = buildFollowUpDraft({
      recruiterName: "陈先生",
      role: "AI 产品经理",
      company: "未序智能",
      stage: "applied",
    });

    expect(draft).toContain("此前向未序智能投递了AI 产品经理岗位");
    expect(draft).toContain("陈先生您好");
  });
});
