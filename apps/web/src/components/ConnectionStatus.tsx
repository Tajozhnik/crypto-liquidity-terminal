"use client";
import { useMarketStore } from "@/state/useMarketStore";

export function ConnectionStatus() {
  const state = useMarketStore((s) => s.connection);
  const labels: Record<typeof state, string> = {
    connected: "Connected",
    connecting: "Connecting…",
    reconnecting: "Reconnecting…",
    disconnected: "Disconnected",
  };
  return (
    <div className={`connection ${state}`}>
      <span className="dot" />
      <span>{labels[state]}</span>
    </div>
  );
}
