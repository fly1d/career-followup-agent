import { getRepository, DEMO_WORKSPACE_ID } from "@/server/database";
import { errorResponse, parseRequest } from "@/server/http";
import { newOpportunitySchema } from "@/server/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const input = await parseRequest(request, newOpportunitySchema);
  if (input instanceof Response) return input;

  try {
    const result = getRepository().createOpportunity(DEMO_WORKSPACE_ID, input);
    return Response.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
