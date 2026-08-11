import { requireCurrentSession } from "@/server/auth";
import { getRepository } from "@/server/database";
import { errorResponse, parseRequest } from "@/server/http";
import { candidateSettingsSchema } from "@/server/schemas";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  try {
    const session = await requireCurrentSession();
    const input = await parseRequest(request, candidateSettingsSchema);
    if (input instanceof Response) return input;
    const repository = await getRepository();
    const settings = await repository.updateSettings(session.workspaceId, input);
    return Response.json({ settings });
  } catch (error) {
    return errorResponse(error);
  }
}
