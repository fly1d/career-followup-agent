import { requireCurrentSession } from "@/server/auth";
import { getRepository } from "@/server/database";
import { errorResponse, parseRequest } from "@/server/http";
import { onboardingSchema } from "@/server/schemas";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  try {
    const session = await requireCurrentSession();
    const input = await parseRequest(request, onboardingSchema);
    if (input instanceof Response) return input;
    const repository = await getRepository();
    return Response.json(
      await repository.completeOnboarding(session.workspaceId, input),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
