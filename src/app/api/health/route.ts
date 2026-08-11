import { getRepository } from "@/server/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const repository = await getRepository();
    await repository.checkHealth();
    return Response.json({
      status: "ok",
      service: "career-followup-agent",
      storage: "ready",
      database: repository.backend,
    });
  } catch (error) {
    console.error("Health check failed", error);
    return Response.json(
      { status: "unavailable", service: "career-followup-agent" },
      { status: 503 },
    );
  }
}
