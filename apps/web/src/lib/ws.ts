"use client";
import { useEffect } from "react";
import { useAlertStore } from "@/state/useAlertStore";
import { useMarketStore } from "@/state/useMarketStore";
import { WS_URL } from "./config";

const RECONNECT_INITIAL_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const THROTTLE_MS = 250;

/**
 * Module-level shared connection. Multiple components can call
 * `useScreenerWebSocket()` and they all share the same socket. Refcount
 * tracks how many subscribers are mounted; the connection only closes
 * when the last one unmounts. Previously a boolean `started` flag plus
 * eager teardown on the first cleanup made the connection fragile in
 * Strict-mode dev (re-mount race) and on multi-page navigations where
 * a second subscriber piggy-backed on the first one's lifecycle.
 */
interface SharedConnection {
  socket: WebSocket | null;
  refcount: number;
  attempt: number;
  unmounted: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  throttleTimer: ReturnType<typeof setTimeout> | null;
  pendingBatch: Array<unknown>;
}

let shared: SharedConnection | null = null;

function getShared(): SharedConnection {
  if (!shared) {
    shared = {
      socket: null,
      refcount: 0,
      attempt: 0,
      unmounted: false,
      reconnectTimer: null,
      throttleTimer: null,
      pendingBatch: [],
    };
  }
  return shared;
}

export function useScreenerWebSocket(): void {
  const setSnapshot = useMarketStore((s) => s.setSnapshot);
  const applyBatch = useMarketStore((s) => s.applyBatch);
  const pushSignal = useMarketStore((s) => s.pushSignal);
  const setConnection = useMarketStore((s) => s.setConnection);
  const setEvents = useAlertStore((s) => s.setEvents);
  const pushEvent = useAlertStore((s) => s.pushEvent);

  useEffect(() => {
    const conn = getShared();
    conn.refcount += 1;
    // First subscriber bootstraps the socket. Subsequent subscribers ride
    // along — store updates flow through the same module-level WebSocket.
    if (conn.refcount === 1) {
      conn.unmounted = false;

      const flushBatch = (): void => {
        if (conn.pendingBatch.length === 0) return;
        const merged = new Map<string, unknown>();
        for (const msg of conn.pendingBatch) {
          const m = msg as { results?: { symbol: string }[] };
          if (m.results) for (const r of m.results) merged.set(r.symbol, r);
        }
        applyBatch([...merged.values()] as Parameters<typeof applyBatch>[0]);
        conn.pendingBatch = [];
      };

      const scheduleFlush = (): void => {
        if (conn.throttleTimer) return;
        conn.throttleTimer = setTimeout(() => {
          conn.throttleTimer = null;
          flushBatch();
        }, THROTTLE_MS);
      };

      const connect = (): void => {
        if (conn.unmounted) return;
        setConnection(conn.attempt === 0 ? "connecting" : "reconnecting");
        const ws = new WebSocket(WS_URL);
        conn.socket = ws;

        ws.addEventListener("open", () => {
          conn.attempt = 0;
          setConnection("connected");
        });

        ws.addEventListener("message", (event) => {
          try {
            const msg = JSON.parse(event.data as string);
            if (msg.type === "snapshot") {
              setSnapshot(msg.markets ?? [], msg.recentSignals ?? []);
              setEvents(msg.recentAlertEvents ?? []);
            } else if (msg.type === "market:batch") {
              conn.pendingBatch.push(msg);
              scheduleFlush();
            } else if (msg.type === "signal:new") {
              pushSignal(msg.signal);
            } else if (msg.type === "alert:triggered") {
              pushEvent(msg.event);
            }
          } catch {
            /* ignore malformed */
          }
        });

        ws.addEventListener("close", () => {
          if (conn.unmounted) return;
          setConnection("reconnecting");
          conn.attempt += 1;
          const delay = Math.min(
            RECONNECT_MAX_MS,
            RECONNECT_INITIAL_MS * 2 ** Math.min(conn.attempt - 1, 5),
          );
          conn.reconnectTimer = setTimeout(connect, delay);
        });

        ws.addEventListener("error", () => {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
        });
      };

      connect();
    }

    return () => {
      const c = getShared();
      c.refcount = Math.max(0, c.refcount - 1);
      // Last subscriber tears the socket down. While at least one component
      // still depends on the connection, we keep it alive — this is the
      // single biggest behaviour change vs the old `started` flag.
      if (c.refcount === 0) {
        c.unmounted = true;
        try {
          c.socket?.close();
        } catch {
          /* ignore */
        }
        c.socket = null;
        if (c.throttleTimer) clearTimeout(c.throttleTimer);
        if (c.reconnectTimer) clearTimeout(c.reconnectTimer);
        c.throttleTimer = null;
        c.reconnectTimer = null;
        c.pendingBatch = [];
        c.attempt = 0;
        setConnection("disconnected");
      }
    };
  }, [applyBatch, pushEvent, pushSignal, setConnection, setEvents, setSnapshot]);
}
