import { DISCLAIMER_TEXT } from "@screener/shared";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { ReadinessProbe } from "@/components/ReadinessProbe";
import { Sidebar } from "@/components/Sidebar";
import { ThemeApplier } from "@/components/ThemeApplier";
import "./globals.css";

export const metadata: Metadata = {
  title: "Crypto Market Screener",
  description: "Mock-first market intelligence tool. For analysis only.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <body>
        <ThemeApplier />
        <ReadinessProbe />
        <div className="app-shell">
          <Sidebar />
          <div className="app-main">
            <header className="topbar">
              <h1 className="topbar-title">Crypto Market Screener</h1>
              <ConnectionStatus />
            </header>
            <main className="content">{children}</main>
            <footer className="disclaimer">{DISCLAIMER_TEXT}</footer>
          </div>
        </div>
      </body>
    </html>
  );
}
