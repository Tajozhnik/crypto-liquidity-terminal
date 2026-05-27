/// <reference lib="dom" />
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPath,
}));

let mockPath = "/";

import { Sidebar } from "@/components/Sidebar";

describe("Sidebar nav links", () => {
  it("shows Liquidity Chart and does NOT show Market Map", () => {
    mockPath = "/";
    const html = renderToStaticMarkup(<Sidebar />);
    expect(html).toContain('href="/heatmap"');
    expect(html).toContain("Liquidity Chart");
    expect(html).toContain("Order book heatmap");
    // Market Map was removed from the sidebar to avoid confusing users.
    expect(html).not.toContain('href="/market-map"');
    expect(html).not.toContain("Market Map");
  });

  it("active class is applied only to the current page", () => {
    mockPath = "/heatmap";
    const html = renderToStaticMarkup(<Sidebar />);
    const heatmapBlock = html.match(/<a[^>]*href="\/heatmap"[^>]*>/)?.[0] ?? "";
    const screenerBlock = html.match(/<a[^>]*href="\/screener"[^>]*>/)?.[0] ?? "";
    expect(heatmapBlock).toMatch(/class="active"/);
    expect(screenerBlock).not.toMatch(/class="active"/);
  });
});
