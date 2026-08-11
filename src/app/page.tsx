import { AuthScreen } from "@/components/auth-screen";
import { Dashboard } from "@/components/dashboard";
import { getCurrentSession } from "@/server/auth";
import { getRepository } from "@/server/database";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getCurrentSession();
  if (!session) return <AuthScreen />;

  const initialSnapshot = getRepository().getWorkspace(session.workspaceId);
  return (
    <Dashboard
      initialSnapshot={initialSnapshot}
      user={{ email: session.user.email, displayName: session.user.displayName }}
    />
  );
}
