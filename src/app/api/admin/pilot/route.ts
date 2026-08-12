import { getRepository } from "@/server/database";
import { errorResponse } from "@/server/http";
import { requirePilotAdmin } from "@/server/pilot-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePilotAdmin();
    const repository = await getRepository();
    return Response.json(await repository.getPilotOperations());
  } catch (error) {
    return errorResponse(error);
  }
}
