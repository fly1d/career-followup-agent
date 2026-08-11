import { getRepository, DEMO_WORKSPACE_ID } from "@/server/database";
import { errorResponse, parseRequest } from "@/server/http";
import { candidateSettingsSchema } from "@/server/schemas";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  const input = await parseRequest(request, candidateSettingsSchema);
  if (input instanceof Response) return input;

  try {
    const settings = getRepository().updateSettings(DEMO_WORKSPACE_ID, input);
    return Response.json({ settings });
  } catch (error) {
    return errorResponse(error);
  }
}
