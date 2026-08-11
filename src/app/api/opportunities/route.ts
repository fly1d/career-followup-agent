import { requireCurrentSession } from "@/server/auth";
import { getRepository } from "@/server/database";
import { errorResponse, parseRequest } from "@/server/http";
import { newOpportunitySchema } from "@/server/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const session = await requireCurrentSession();
    const input = await parseRequest(request, newOpportunitySchema);
    if (input instanceof Response) return input;
    const repository = await getRepository();
    const result = await repository.createOpportunity(session.workspaceId, input);
    return Response.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
