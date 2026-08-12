import { loginAccount, setSessionCookie } from "@/server/auth";
import { errorResponse, parseRequest } from "@/server/http";
import { getTrustedClientAddress } from "@/server/rate-limit";
import { loginSchema } from "@/server/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = await parseRequest(request, loginSchema);
    if (input instanceof Response) return input;
    const { identity, token, expiresAt } = await loginAccount(input, {
      clientAddress: getTrustedClientAddress(request),
    });
    await setSessionCookie(token, expiresAt);
    return Response.json({
      user: {
        email: identity.user.email,
        displayName: identity.user.displayName,
      },
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
