import { getRepository } from "@/server/database";
import { errorResponse, parseRequest } from "@/server/http";
import { requirePilotAdmin } from "@/server/pilot-admin";
import { pilotAdminActionSchema } from "@/server/schemas";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requirePilotAdmin();
    const input = await parseRequest(request, pilotAdminActionSchema);
    if (input instanceof Response) return input;
    const { id } = await context.params;
    const repository = await getRepository();
    return Response.json(
      await repository.confirmPilotPayment(id, session.user.email),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
