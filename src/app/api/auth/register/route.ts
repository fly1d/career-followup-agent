import { registerAccount, setSessionCookie } from "@/server/auth";
import { errorResponse, parseRequest } from "@/server/http";
import { registrationSchema } from "@/server/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = await parseRequest(request, registrationSchema);
    if (input instanceof Response) return input;
    const { identity, token, expiresAt } = await registerAccount(input);
    await setSessionCookie(token, expiresAt);
    return Response.json(
      {
        user: {
          email: identity.user.email,
          displayName: identity.user.displayName,
        },
        expiresAt: expiresAt.toISOString(),
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
