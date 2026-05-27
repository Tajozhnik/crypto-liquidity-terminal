import type { Alert, AlertEvent, AlertInput, AlertPatch } from "@screener/shared";
import { getPrisma, isDbAvailable, markDbUnavailable } from "../db/prisma.js";
import { logger } from "../logger.js";

/**
 * Storage abstraction for alerts. Uses Prisma when DB is available, else falls
 * back to an in-memory map so the MVP remains evaluable without Postgres.
 *
 * The interface returns API-shaped objects (timestamps as ISO 8601 strings).
 */

let _seq = 0;
const cuid = () => `mock_${Date.now().toString(36)}_${(_seq++).toString(36)}`;

type AlertRow = Alert;
type AlertEventRow = AlertEvent;

const memAlerts = new Map<string, AlertRow>();
const memEvents: AlertEventRow[] = [];
const MAX_MEM_EVENTS = 1000;

function nowIso(): string {
  return new Date().toISOString();
}

function isoFromDate(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function fromDb(row: {
  id: string;
  symbol: string;
  exchange: string;
  marketType: string;
  conditionType: string;
  operator: string;
  threshold: number;
  timeframe: string | null;
  enabled: boolean;
  cooldownSeconds: number;
  lastTriggeredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): AlertRow {
  return {
    id: row.id,
    symbol: row.symbol,
    exchange: row.exchange as Alert["exchange"],
    marketType: row.marketType as Alert["marketType"],
    conditionType: row.conditionType as Alert["conditionType"],
    operator: row.operator as Alert["operator"],
    threshold: row.threshold,
    timeframe: row.timeframe,
    enabled: row.enabled,
    cooldownSeconds: row.cooldownSeconds,
    lastTriggeredAt: isoFromDate(row.lastTriggeredAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function eventFromDb(row: {
  id: string;
  alertId: string;
  symbol: string;
  message: string;
  value: number;
  threshold: number;
  triggeredAt: Date;
}): AlertEventRow {
  return {
    id: row.id,
    alertId: row.alertId,
    symbol: row.symbol,
    message: row.message,
    value: row.value,
    threshold: row.threshold,
    triggeredAt: row.triggeredAt.toISOString(),
  };
}

export const alertStore = {
  isMemory(): boolean {
    return !isDbAvailable();
  },

  async list(): Promise<AlertRow[]> {
    const prisma = getPrisma();
    if (prisma) {
      try {
        const rows = await prisma.alert.findMany({ orderBy: { createdAt: "desc" } });
        return rows.map(fromDb);
      } catch (err) {
        markDbUnavailable((err as Error).message);
        logger.warn({ err: (err as Error).message }, "AlertStore.list DB read failed; falling back");
      }
    }
    return [...memAlerts.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },

  async get(id: string): Promise<AlertRow | null> {
    const prisma = getPrisma();
    if (prisma) {
      try {
        const row = await prisma.alert.findUnique({ where: { id } });
        return row ? fromDb(row) : null;
      } catch (err) {
        markDbUnavailable((err as Error).message);
        logger.warn({ err: (err as Error).message }, "AlertStore.get DB read failed; falling back");
      }
    }
    return memAlerts.get(id) ?? null;
  },

  async listEnabled(): Promise<AlertRow[]> {
    const all = await this.list();
    return all.filter((a) => a.enabled);
  },

  async create(input: AlertInput): Promise<AlertRow> {
    const prisma = getPrisma();
    if (prisma) {
      try {
        const row = await prisma.alert.create({ data: input });
        return fromDb(row);
      } catch (err) {
        markDbUnavailable((err as Error).message);
        logger.warn({ err: (err as Error).message }, "AlertStore.create DB write failed; falling back");
      }
    }
    const now = nowIso();
    const row: AlertRow = {
      id: cuid(),
      symbol: input.symbol,
      exchange: input.exchange,
      marketType: input.marketType,
      conditionType: input.conditionType,
      operator: input.operator,
      threshold: input.threshold,
      timeframe: input.timeframe ?? null,
      enabled: input.enabled,
      cooldownSeconds: input.cooldownSeconds,
      lastTriggeredAt: null,
      createdAt: now,
      updatedAt: now,
    };
    memAlerts.set(row.id, row);
    return row;
  },

  async update(id: string, patch: AlertPatch): Promise<AlertRow | null> {
    const prisma = getPrisma();
    const wasEnabled = (await this.get(id))?.enabled ?? null;
    const willEnable = patch.enabled === true && wasEnabled === false;
    const data: Record<string, unknown> = { ...patch };
    // Cooldown reset on disable→enable transition (Requirement 13.6)
    if (willEnable) data.lastTriggeredAt = null;

    if (prisma) {
      try {
        const row = await prisma.alert.update({ where: { id }, data });
        return fromDb(row);
      } catch (err) {
        // Distinguish "row missing" from "DB down" — Prisma throws P2025 for
        // missing rows, which is not a connectivity issue.
        const code = (err as { code?: string }).code;
        if (code === "P2025") return null;
        markDbUnavailable((err as Error).message);
        logger.warn({ err: (err as Error).message }, "AlertStore.update DB write failed; falling back");
      }
    }
    const existing = memAlerts.get(id);
    if (!existing) return null;
    const updated: AlertRow = {
      ...existing,
      ...patch,
      timeframe: patch.timeframe === undefined ? existing.timeframe : (patch.timeframe ?? null),
      lastTriggeredAt: willEnable ? null : existing.lastTriggeredAt,
      updatedAt: nowIso(),
    };
    memAlerts.set(id, updated);
    return updated;
  },

  async delete(id: string): Promise<boolean> {
    const prisma = getPrisma();
    if (prisma) {
      try {
        await prisma.alert.delete({ where: { id } });
        return true;
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "P2025") return false; // row missing
        markDbUnavailable((err as Error).message);
        logger.warn({ err: (err as Error).message }, "AlertStore.delete DB write failed; falling back");
      }
    }
    return memAlerts.delete(id);
  },

  async setLastTriggered(id: string, iso: string): Promise<void> {
    const prisma = getPrisma();
    if (prisma) {
      try {
        await prisma.alert.update({ where: { id }, data: { lastTriggeredAt: new Date(iso) } });
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code !== "P2025") {
          markDbUnavailable((err as Error).message);
          logger.warn({ err: (err as Error).message }, "AlertStore.setLastTriggered DB write failed");
        }
      }
      return;
    }
    const existing = memAlerts.get(id);
    if (existing) memAlerts.set(id, { ...existing, lastTriggeredAt: iso, updatedAt: nowIso() });
  },

  async createEvent(input: Omit<AlertEventRow, "id" | "triggeredAt">): Promise<AlertEventRow> {
    const prisma = getPrisma();
    if (prisma) {
      try {
        const row = await prisma.alertEvent.create({ data: { ...input, triggeredAt: new Date() } });
        return eventFromDb(row);
      } catch (err) {
        markDbUnavailable((err as Error).message);
        logger.warn({ err: (err as Error).message }, "AlertStore.createEvent DB write failed; falling back");
      }
    }
    const ev: AlertEventRow = { id: cuid(), triggeredAt: nowIso(), ...input };
    memEvents.unshift(ev);
    if (memEvents.length > MAX_MEM_EVENTS) memEvents.length = MAX_MEM_EVENTS;
    return ev;
  },

  async listEvents(limit: number): Promise<AlertEventRow[]> {
    const prisma = getPrisma();
    if (prisma) {
      try {
        const rows = await prisma.alertEvent.findMany({
          orderBy: { triggeredAt: "desc" },
          take: limit,
        });
        return rows.map(eventFromDb);
      } catch (err) {
        markDbUnavailable((err as Error).message);
        logger.warn({ err: (err as Error).message }, "AlertStore.listEvents DB read failed; falling back");
      }
    }
    return memEvents.slice(0, limit);
  },

  async listEventsForAlert(alertId: string, limit: number): Promise<AlertEventRow[]> {
    const all = await this.listEvents(500);
    return all.filter((e) => e.alertId === alertId).slice(0, limit);
  },
};
