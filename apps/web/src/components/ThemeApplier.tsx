"use client";
import { useEffect } from "react";
import { useLocalSettings } from "@/state/useLocalSettings";

export function ThemeApplier() {
  const theme = useLocalSettings((s) => s.theme);
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = theme;
    }
  }, [theme]);
  return null;
}
