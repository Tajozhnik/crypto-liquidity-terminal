"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV: { href: string; label: string; subtitle: string }[] = [
  { href: "/", label: "Dashboard", subtitle: "Overview" },
  { href: "/screener", label: "Screener", subtitle: "Sortable market table" },
  { href: "/heatmap", label: "Liquidity Chart", subtitle: "Order book heatmap" },
  { href: "/signals", label: "Signals", subtitle: "Live detector feed" },
  { href: "/alerts", label: "Alerts", subtitle: "User-defined rules" },
  { href: "/settings", label: "Settings", subtitle: "Defaults and runtime" },
];

export function Sidebar() {
  const pathname = usePathname();
  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  };
  return (
    <aside className="sidebar">
      <h2>Crypto Market Screener</h2>
      <nav>
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={isActive(item.href) ? "active" : ""}
            aria-current={isActive(item.href) ? "page" : undefined}
            title={item.subtitle}
          >
            <span className="nav-label">{item.label}</span>
            <span className="nav-sub">{item.subtitle}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
