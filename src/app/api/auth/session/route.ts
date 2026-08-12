import { getCurrentSession } from "@/server/auth";
import { errorResponse } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session) return Response.json({ authenticated: false, user: null });
    return Response.json({
      authenticated: true,
      user: {
        id: session.user.id,
        email: session.user.email,
        displayName: session.user.displayName,
      },
      expiresAt: session.expiresAt,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
