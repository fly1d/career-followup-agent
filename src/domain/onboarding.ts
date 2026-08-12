export const searchStages = [
  "preparing",
  "actively_applying",
  "interviewing",
  "offer_decision",
] as const;

export type SearchStage = (typeof searchStages)[number];

export interface OnboardingProfile {
  targetRole: string;
  targetCity: string;
  searchStage: SearchStage;
  currentOpportunityCount: number;
  completedAt: string | null;
}

export type OnboardingInput = Omit<OnboardingProfile, "completedAt">;

export const emptyOnboardingProfile: OnboardingProfile = {
  targetRole: "",
  targetCity: "",
  searchStage: "actively_applying",
  currentOpportunityCount: 0,
  completedAt: null,
};
