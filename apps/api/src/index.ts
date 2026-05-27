import { loadEnv } from "./config/env.js";
import { logger } from "./logger.js";
import { buildServer, shutdownContext, type AppContext } from "./server.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const ctx: AppContext = await buildServer();

  await ctx.fastify.listen({ port: env.API_PORT, host: "0.0.0.0" });
  logger.info({ port: env.API_PORT, mockMode: env.USE_MOCK_DATA }, "API server listening");

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down");
    try {
      await shutdownContext(ctx);
    } catch (err) {
      logger.error({ err: (err as Error).message }, "Error during shutdown");
    }
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal startup error:", err);
  process.exit(1);
});
