import { z } from "zod";
import { searchStages } from "@/domain/onboarding";

const requiredText = (label: string, maximum: number) =>
  z
    .string({ error: `${label}必须是文本` })
    .trim()
    .min(1, `${label}不能为空`)
    .max(maximum, `${label}过长`);

const emailSchema = z
  .string({ error: "邮箱必须是文本" })
  .trim()
  .max(254, "邮箱地址过长")
  .pipe(z.email("请输入有效的邮箱地址"))
  .transform((email) => email.toLowerCase());

const passwordSchema = z
  .string({ error: "密码必须是文本" })
  .min(10, "密码至少需要 10 位")
  .max(128, "密码最多 128 位")
  .regex(/\p{L}/u, "密码需要包含字母")
  .regex(/\d/, "密码需要包含数字");

export const registrationSchema = z.object({
  displayName: requiredText("姓名", 80),
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string({ error: "密码必须是文本" }).min(1, "请输入密码").max(128),
});

export const newOpportunitySchema = z.object({
  company: requiredText("公司名称", 100),
  role: requiredText("岗位名称", 120),
  location: z.string().trim().max(80).default(""),
  salary: z.string().trim().max(80).default(""),
});

export const onboardingSchema = z.object({
  targetRole: requiredText("目标岗位", 120),
  targetCity: requiredText("目标城市", 80),
  searchStage: z.enum(searchStages),
  currentOpportunityCount: z.number().int().min(0).max(500),
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
