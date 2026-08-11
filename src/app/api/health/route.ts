import { getRepository } from "@/server/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    getRepository().checkHealth();
    return Response.json({
      status: "ok",
      service: "career-followup-agent",
      storage: "ready",
    });
  } catch (error) {
    console.error("Health check failed", error);
    return Response.json(
      { status: "unavailable", service: "career-followup-agent" },
      { status: 503 },
    );
  }
}
