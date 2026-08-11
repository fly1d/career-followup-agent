import { getRepository, DEMO_WORKSPACE_ID } from "@/server/database";
import { errorResponse } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    return Response.json(getRepository().getWorkspace(DEMO_WORKSPACE_ID));
  } catch (error) {
    return errorResponse(error);
  }
}
