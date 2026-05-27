import { PrismaClient } from "@prisma/client";
import { logger } from "../logger.js";

let _client: PrismaClient | null = null;
let _available = false;
let _reconnectTimer: NodeJS.Timeout | null = null;

export function getPrisma(): PrismaClient | null {
  return _available ? _client : null;
}

export function isDbAvailable(): boolean {
  return _available;
}

/**
 * Mark the database as unavailable after a runtime query failure (e.g. the
 * Postgres container was stopped mid-session). Routes call this when a Prisma
 * call throws so the next request does not retry the dead connection. The
 * background reconnect job will flip `_available` back to true once Postgres
 * accepts queries again.
 */
export function markDbUnavailable(reason: string): void {
  if (!_available) return;
  _available = false;
  logger.warn({ reason }, "Database marked unavailable; falling back to in-memory");
}

/** Best-effort connection. Never throws. Marks `_available` accordingly. */
export async function initDatabase(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    logger.warn("DATABASE_URL not set; persistence disabled, using in-memory fallback");
    _available = false;
    return;
  }
  try {
    const client = new PrismaClient({ log: ["error"] });
    await client.$connect();
    await client.$queryRawUnsafe("SELECT 1");
    _client = client;
    _available = true;
    logger.info("Database connected");
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "Database unavailable; persistence endpoints will return 503 / fallback to in-memory",
    );
    try {
      await _client?.$disconnect();
    } catch {
      /* ignore */
    }
    _client = null;
    _available = false;
  }
}

/**
 * Periodic background retry — when the DB comes up later, persistence transparently resumes.
 */
export function scheduleDbReconnect(): void {
  if (_reconnectTimer) return;
  _reconnectTimer = setInterval(() => {
    if (_available) return;
    void initDatabase();
  }, 30_000);
}

export async function shutdownDatabase(): Promise<void> {
  if (_reconnectTimer) clearInterval(_reconnectTimer);
  _reconnectTimer = null;
  try {
    await _client?.$disconnect();
  } catch {
    /* ignore */
  }
  _client = null;
  _available = false;
}
