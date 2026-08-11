import { z } from "zod";

const requiredText = (label: string, maximum: number) =>
  z
    .string({ error: `${label}必须是文本` })
    .trim()
    .min(1, `${label}不能为空`)
    .max(maximum, `${label}过长`);

export const newOpportunitySchema = z.object({
  company: requiredText("公司名称", 100),
  role: requiredText("岗位名称", 120),
  location: z.string().trim().max(80).default(""),
  salary: z.string().trim().max(80).default(""),
});

export const followUpMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("mark_sent"),
    message: requiredText("消息内容", 2000),
  }),
  z.object({ action: z.literal("snooze") }),
  z.object({ action: z.literal("skip") }),
]);

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const candidateSettingsSchema = z.object({
  targetRoles: requiredText("目标岗位", 300),
  targetCities: requiredText("目标城市", 200),
  minimumMonthlySalary: z.number().int().min(0).max(1000),
  exclusions: z.string().trim().max(500),
  confirmBeforeSend: z.boolean(),
  avoidWeekends: z.boolean(),
  maxFollowUps: z.number().int().min(1).max(3),
  deliveryStart: timeSchema,
  deliveryEnd: timeSchema,
});
