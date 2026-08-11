import { requireCurrentSession } from "@/server/auth";
import { getRepository } from "@/server/database";
import { errorResponse } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireCurrentSession();
    const repository = await getRepository();
    return Response.json(await repository.getWorkspace(session.workspaceId));
  } catch (error) {
    return errorResponse(error);
  }
}
