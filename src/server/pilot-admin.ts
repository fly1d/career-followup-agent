import "server-only";

import { requireCurrentSession } from "./auth";
import { AuthorizationError } from "./errors";
import { isPilotAdminIdentity } from "./pilot-admin-policy";

export function isPilotAdminUser(user: { id: string; email: string }) {
  return isPilotAdminIdentity(user, {
    adminUserIds: process.env.ADMIN_USER_IDS,
    adminEmails: process.env.ADMIN_EMAILS,
    environment: process.env.NODE_ENV,
  });
}

export async function requirePilotAdmin() {
  const session = await requireCurrentSession();
  if (!isPilotAdminUser(session.user)) {
    throw new AuthorizationError("Pilot administrator required");
  }
  return session;
}
