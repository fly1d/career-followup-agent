export interface CandidateSettings {
  targetRoles: string;
  targetCities: string;
  minimumMonthlySalary: number;
  exclusions: string;
  confirmBeforeSend: boolean;
  avoidWeekends: boolean;
  maxFollowUps: number;
  deliveryStart: string;
  deliveryEnd: string;
}

export const defaultCandidateSettings: CandidateSettings = {
  targetRoles: "高级产品经理、AI 产品经理",
  targetCities: "上海、杭州",
  minimumMonthlySalary: 28,
  exclusions: "外包、纯销售岗位",
  confirmBeforeSend: true,
  avoidWeekends: true,
  maxFollowUps: 2,
  deliveryStart: "09:30",
  deliveryEnd: "18:30",
};
