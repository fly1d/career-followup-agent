export function isPilotAdminIdentity(
  user: { id: string; email: string },
  configuration: {
    adminUserIds?: string;
    adminEmails?: string;
    environment?: string;
  },
) {
  const configuredValues = (value: string | undefined) =>
    new Set(
      (value ?? "")
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    );
  const configuredUserIds = configuredValues(configuration.adminUserIds);
  if (configuredUserIds.has(user.id.trim().toLowerCase())) return true;

  return (
    configuration.environment !== "production" &&
    configuredValues(configuration.adminEmails).has(
      user.email.trim().toLowerCase(),
    )
  );
}
