export const PILOT_OFFER_ID = "job-search-sprint-2026";
export const PILOT_PRICE_CENTS = 9_900;
export const PILOT_DURATION_DAYS = 30;
export const PILOT_CAPACITY = 10;

export const pilotContactMethods = ["wechat", "phone", "email"] as const;
export type PilotContactMethod = (typeof pilotContactMethods)[number];

export interface PilotRequestInput {
  contactMethod: PilotContactMethod;
  contactValue: string;
  note: string;
}

export type PilotEnrollmentStatus =
  | "available"
  | "pending_payment"
  | "active"
  | "expired"
  | "full";

export interface PilotEnrollment {
  offerId: string;
  status: PilotEnrollmentStatus;
  orderId: string | null;
  priceCents: number;
  currency: "CNY";
  durationDays: number;
  capacity: number;
  confirmedCount: number;
  requestedAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
}

export interface PilotAdminOrder {
  id: string;
  workspaceId: string;
  user: {
    email: string;
    displayName: string;
  };
  contactMethod: PilotContactMethod;
  contactValue: string;
  note: string;
  status: "pending_payment" | "active" | "expired";
  requestedAt: string;
  paidAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  confirmedBy: string | null;
}

export interface PilotFunnel {
  registered: number;
  onboarded: number;
  firstOpportunityAdded: number;
  firstFollowUpConfirmed: number;
  purchaseRequested: number;
  paymentConfirmed: number;
}

export interface PilotOperationsSnapshot {
  offer: {
    offerId: string;
    priceCents: number;
    currency: "CNY";
    durationDays: number;
    capacity: number;
    confirmedCount: number;
    remainingCount: number;
  };
  funnel: PilotFunnel;
  orders: PilotAdminOrder[];
}
