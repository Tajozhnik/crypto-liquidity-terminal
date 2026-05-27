import { ServerSettings } from "@screener/shared";
import type { FastifyInstance } from "fastify";
import { getPrisma, markDbUnavailable } from "../db/prisma.js";
import { logger } from "../logger.js";

const SETTINGS_KEY = "global";

/** In-memory fallback used when the database is unavailable. */
let memoryStore: ServerSettings | null = null;

function defaults(): ServerSettings {
  return ServerSettings.parse({});
}

export async function registerSettingsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/settings", async () => {
    const prisma = getPrisma();
    if (prisma) {
      try {
        const row = await prisma.userSetting.findUnique({ where: { key: SETTINGS_KEY } });
        if (!row) return { ...defaults(), persisted: true, storage: "database" as const };
        const parsed = ServerSettings.parse(row.value);
        return { ...parsed, persisted: true, storage: "database" as const };
      } catch (err) {
        // Postgres went away mid-request — flip the global flag so subsequent
        // calls skip the DB, and serve the in-memory copy.
        markDbUnavailable((err as Error).message);
        logger.warn({ err: (err as Error).message }, "GET /settings DB read failed; using memory fallback");
      }
    }
    const value = memoryStore ?? defaults();
    return { ...value, persisted: false, storage: "memory" as const };
  });

  fastify.patch("/settings", async (req) => {
    const partial = ServerSettings.partial().parse(req.body);
    const prisma = getPrisma();
    if (prisma) {
      try {
        const existing = await prisma.userSetting.findUnique({ where: { key: SETTINGS_KEY } });
        const merged = ServerSettings.parse({ ...((existing?.value as object) ?? {}), ...partial });
        await prisma.userSetting.upsert({
          where: { key: SETTINGS_KEY },
          create: { key: SETTINGS_KEY, value: merged },
          update: { value: merged },
        });
        return { ...merged, persisted: true, storage: "database" as const };
      } catch (err) {
        markDbUnavailable((err as Error).message);
        logger.warn({ err: (err as Error).message }, "PATCH /settings DB write failed; using memory fallback");
        // fall through to memory path below
      }
    }
    // DB unavailable — store in memory + reflect to client; client should also
    // mirror the value to localStorage. We return 200 so the UI can still
    // accept the user's choice.
    const base = memoryStore ?? defaults();
    const merged = ServerSettings.parse({ ...base, ...partial });
    memoryStore = merged;
    return {
      ...merged,
      persisted: false,
      storage: "memory" as const,
      warning: "Database unavailable; settings are stored in memory and will reset on restart.",
    };
  });
}
