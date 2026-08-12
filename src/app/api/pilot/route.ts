import { requireCurrentSession } from "@/server/auth";
import { getRepository } from "@/server/database";
import { errorResponse, parseRequest } from "@/server/http";
import { pilotRequestSchema } from "@/server/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const session = await requireCurrentSession();
    const input = await parseRequest(request, pilotRequestSchema);
    if (input instanceof Response) return input;
    const repository = await getRepository();
    const pilot = await repository.requestPilotEnrollment(
      session.workspaceId,
      input,
    );
    return Response.json({ pilot }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
