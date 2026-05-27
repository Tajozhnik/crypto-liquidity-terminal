import { AlertInput, AlertPatch } from "@screener/shared";
import type { FastifyInstance } from "fastify";
import { notFoundError } from "../plugins/errorHandler.js";
import { alertStore } from "../state/AlertStore.js";

export async function registerAlertsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post("/alerts", async (req, reply) => {
    const input = AlertInput.parse(req.body);
    const row = await alertStore.create(input);
    reply.code(201);
    return row;
  });

  fastify.get("/alerts", async () => alertStore.list());

  fastify.get<{ Params: { id: string } }>("/alerts/:id", async (req) => {
    const row = await alertStore.get(req.params.id);
    if (!row) throw notFoundError("alert", req.params.id);
    return row;
  });

  fastify.patch<{ Params: { id: string } }>("/alerts/:id", async (req) => {
    const patch = AlertPatch.parse(req.body);
    const row = await alertStore.update(req.params.id, patch);
    if (!row) throw notFoundError("alert", req.params.id);
    return row;
  });

  fastify.delete<{ Params: { id: string } }>("/alerts/:id", async (req, reply) => {
    const ok = await alertStore.delete(req.params.id);
    if (!ok) throw notFoundError("alert", req.params.id);
    reply.code(204);
    return null;
  });

  fastify.get<{ Querystring: { limit?: string; alertId?: string } }>("/alert-events", async (req) => {
    const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit ?? "100", 10) || 100));
    if (req.query.alertId) {
      return alertStore.listEventsForAlert(req.query.alertId, limit);
    }
    return alertStore.listEvents(limit);
  });
}
