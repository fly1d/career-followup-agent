import { getRepository, DEMO_WORKSPACE_ID } from "@/server/database";
import { errorResponse, parseRequest } from "@/server/http";
import { followUpMutationSchema } from "@/server/schemas";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const input = await parseRequest(request, followUpMutationSchema);
  if (input instanceof Response) return input;

  try {
    const { id } = await context.params;
    const followUp = getRepository().updateFollowUp(
      DEMO_WORKSPACE_ID,
      id,
      input,
    );
    return Response.json({ followUp });
  } catch (error) {
    return errorResponse(error);
  }
}
