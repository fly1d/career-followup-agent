import { logoutCurrentSession } from "@/server/auth";
import { errorResponse } from "@/server/http";

export const runtime = "nodejs";

export async function POST() {
  try {
    await logoutCurrentSession();
    return Response.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
