import { requireCurrentSession } from "@/server/auth";
import { getRepository } from "@/server/database";
import { errorResponse, parseRequest } from "@/server/http";
import { followUpMutationSchema } from "@/server/schemas";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireCurrentSession();
    const input = await parseRequest(request, followUpMutationSchema);
    if (input instanceof Response) return input;
    const { id } = await context.params;
    const followUp = getRepository().updateFollowUp(
      session.workspaceId,
      id,
      input,
    );
    return Response.json({ followUp });
  } catch (error) {
    return errorResponse(error);
  }
}
