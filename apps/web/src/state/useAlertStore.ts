"use client";
import type { Alert, AlertEvent } from "@screener/shared";
import { create } from "zustand";

interface AlertStore {
  alerts: Alert[];
  events: AlertEvent[];
  setAlerts: (a: Alert[]) => void;
  addAlert: (a: Alert) => void;
  updateAlert: (a: Alert) => void;
  removeAlert: (id: string) => void;
  pushEvent: (e: AlertEvent) => void;
  setEvents: (events: AlertEvent[]) => void;
}

export const useAlertStore = create<AlertStore>((set) => ({
  alerts: [],
  events: [],
  setAlerts: (alerts) => set({ alerts }),
  addAlert: (a) => set((state) => ({ alerts: [a, ...state.alerts] })),
  updateAlert: (a) =>
    set((state) => ({
      alerts: state.alerts.map((x) => (x.id === a.id ? a : x)),
    })),
  removeAlert: (id) =>
    set((state) => ({
      alerts: state.alerts.filter((x) => x.id !== id),
    })),
  pushEvent: (e) =>
    set((state) => ({
      events: [e, ...state.events].slice(0, 200),
    })),
  setEvents: (events) => set({ events }),
}));
