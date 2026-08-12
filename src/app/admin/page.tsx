import { redirect } from "next/navigation";
import { PilotOperations } from "@/components/pilot-operations";
import { getCurrentSession } from "@/server/auth";
import { getRepository } from "@/server/database";
import { isPilotAdminUser } from "@/server/pilot-admin";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await getCurrentSession();
  if (!session || !isPilotAdminUser(session.user)) redirect("/");

  const repository = await getRepository();
  const initialSnapshot = await repository.getPilotOperations();
  return (
    <PilotOperations
      initialSnapshot={initialSnapshot}
      user={{
        email: session.user.email,
        displayName: session.user.displayName,
      }}
    />
  );
}
