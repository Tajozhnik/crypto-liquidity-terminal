import { pino } from "pino";
import { loadEnv } from "./config/env.js";

const env = loadEnv();

export const logger = pino({
  level: env.LOG_LEVEL,
  transport: env.LOG_LEVEL === "debug" || process.env.NODE_ENV !== "production"
    ? { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss" } }
    : undefined,
});
