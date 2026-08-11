import type { z } from "zod";
import {
  RepositoryConflictError,
  RepositoryNotFoundError,
} from "./repository";

export async function parseRequest<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<z.infer<T> | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { code: "invalid_json", message: "请求内容不是有效 JSON。" } },
      { status: 400 },
    );
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    return Response.json(
      {
        error: {
          code: "validation_failed",
          message: "请求内容不符合要求。",
          fields: result.error.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }
  return result.data;
}

export function errorResponse(error: unknown) {
  if (error instanceof RepositoryNotFoundError) {
    return Response.json(
      { error: { code: "not_found", message: "请求的记录不存在。" } },
      { status: 404 },
    );
  }
  if (error instanceof RepositoryConflictError) {
    return Response.json(
      { error: { code: "state_conflict", message: "当前状态不能执行此操作。" } },
      { status: 409 },
    );
  }

  console.error("API request failed", error);
  return Response.json(
    { error: { code: "internal_error", message: "服务暂时不可用。" } },
    { status: 500 },
  );
}
