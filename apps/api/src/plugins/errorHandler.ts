import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

export type AppErrorCode =
  | "validation_error"
  | "not_found"
  | "payload_too_large"
  | "unsupported_media_type"
  | "RATE_LIMITED"
  | "service_unavailable"
  | "internal_error";

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function notFoundError(resource: string, id: string): AppError {
  return new AppError("not_found", 404, `${resource} '${id}' not found`);
}

export function serviceUnavailable(message: string): AppError {
  return new AppError("service_unavailable", 503, message);
}

export function registerErrorHandler(fastify: FastifyInstance): void {
  fastify.setErrorHandler((err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) => {
    // Zod validation
    if (err instanceof ZodError) {
      const body = {
        error: "validation_error",
        message: "Request validation failed",
        statusCode: 400,
        details: err.issues.map((i) => ({ path: i.path, message: i.message, code: i.code })),
      };
      req.log.warn({ reqId: req.id, statusCode: 400, errorCode: body.error }, "validation error");
      reply.code(400).send(body);
      return;
    }

    // Our own errors
    if (err instanceof AppError) {
      const body = {
        error: err.code,
        message: err.message.slice(0, 500),
        statusCode: err.statusCode,
        ...(err.details !== undefined ? { details: err.details } : {}),
      };
      req.log.warn({ reqId: req.id, statusCode: err.statusCode, errorCode: err.code }, err.message);
      reply.code(err.statusCode).send(body);
      return;
    }

    // Fastify built-in errors (Content-Type, body too large)
    const fErr = err as FastifyError;
    if (fErr.statusCode === 413) {
      const body = { error: "payload_too_large", message: "Body too large (max 1 MB)", statusCode: 413 };
      reply.code(413).send(body);
      return;
    }
    if (fErr.statusCode === 415) {
      const body = { error: "unsupported_media_type", message: "Content-Type must be application/json", statusCode: 415 };
      reply.code(415).send(body);
      return;
    }
    if (fErr.statusCode === 429) {
      const retryAfter = (reply.getHeader("Retry-After") as string) ?? "60";
      const body = {
        error: "RATE_LIMITED",
        message: fErr.message ?? "Rate limit exceeded",
        statusCode: 429,
        retryAfterSeconds: Number.parseInt(retryAfter, 10) || 60,
      };
      reply.code(429).send(body);
      return;
    }

    // Unknown error
    req.log.error({ reqId: req.id, err: err.message }, "unhandled error");
    reply.code(500).send({
      error: "internal_error",
      message: "Internal server error",
      statusCode: 500,
    });
  });
}
