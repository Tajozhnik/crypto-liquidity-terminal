/* eslint-disable no-console */
/**
 * Captures the screenshots referenced in README.md → ## Screenshots.
 *
 * Prerequisites:
 *   docker compose up --build       (or pnpm dev:api + pnpm dev:web)
 *   wait ~5 minutes so the screener and the Liquidity Chart accumulate data
 *   npm install -D playwright       (or run via npx playwright)
 *   npx playwright install chromium
 *
 * Then:
 *   pnpm tsx scripts/take-screenshots.ts
 *
 * Override the base URL with --base, e.g.
 *   pnpm tsx scripts/take-screenshots.ts --base=http://localhost:3000
 *
 * Output: docs/screenshots/0X-*.png + docs/screenshots/08-mobile.png
 */
import { chromium, devices, type Browser, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

interface Shot {
  filename: string;
  route: string;
  description: string;
  /** Optional setup before the snapshot (e.g. wait for selector). */
  prepare?: (page: Page) => Promise<void>;
  /** When set, full-page screenshot (otherwise viewport only). */
  fullPage?: boolean;
}

const SHOTS: Shot[] = [
  {
    filename: "01-liquidity-chart.png",
    route: "/heatmap",
    description: "Liquidity Chart — heatmap, candles, volume histogram, order book panel",
    prepare: async (p) => {
      // Wait for the chart canvas to mount and ~12s for the WS to accumulate.
      await p.waitForSelector(".liq-chart canvas", { timeout: 30_000 });
      await p.waitForTimeout(12_000);
    },
    fullPage: true,
  },
  {
    filename: "02-liquidity-drawings.png",
    route: "/heatmap",
    description: "Liquidity Chart with horizontal / trend / rectangle drawings",
    prepare: async (p) => {
      await p.waitForSelector(".liq-chart canvas", { timeout: 30_000 });
      await p.waitForTimeout(8_000);
      // Pick the horizontal-line tool, click in the middle of the chart twice
      const horiz = p.getByRole("button", { name: /Horizontal Line/i });
      if (await horiz.count()) {
        await horiz.first().click();
        const canvas = p.locator(".liq-canvas-overlay");
        const box = await canvas.boundingBox();
        if (box) {
          await p.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.55);
          await p.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.4);
        }
      }
      // Now switch to the trend tool and place two anchors.
      const trend = p.getByRole("button", { name: /Trend Line/i });
      if (await trend.count()) {
        await trend.first().click();
        const canvas = p.locator(".liq-canvas-overlay");
        const box = await canvas.boundingBox();
        if (box) {
          await p.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.7);
          await p.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.3);
        }
      }
      // Rectangle tool
      const rect = p.getByRole("button", { name: /^Rectangle$/i });
      if (await rect.count()) {
        await rect.first().click();
        const canvas = p.locator(".liq-canvas-overlay");
        const box = await canvas.boundingBox();
        if (box) {
          await p.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.45);
          await p.mouse.down();
          await p.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.65, { steps: 12 });
          await p.mouse.up();
        }
      }
      await p.waitForTimeout(800);
    },
    fullPage: true,
  },
  {
    filename: "03-screener.png",
    route: "/screener",
    description: "Screener with filters / sort / score / signals",
    prepare: async (p) => {
      await p.waitForSelector("table.table", { timeout: 30_000 });
      await p.waitForTimeout(2_000);
    },
    fullPage: true,
  },
  {
    filename: "04-market-detail.png",
    route: "/markets/BTCUSDT",
    description: "Market detail — metrics, sparkline, order book, trades, signals",
    prepare: async (p) => {
      await p.waitForSelector(".detail-header", { timeout: 30_000 });
      await p.waitForTimeout(2_500);
    },
    fullPage: true,
  },
  {
    filename: "05-alerts.png",
    route: "/alerts",
    description: "Alerts — create form + active alerts + recent events",
    prepare: async (p) => {
      await p.waitForSelector(".alert-form", { timeout: 30_000 });
      await p.waitForTimeout(1_500);
    },
    fullPage: true,
  },
  {
    filename: "06-settings-readiness.png",
    route: "/settings",
    description: "Settings — Live Public Data, enabled exchanges, db ok, redis ok",
    prepare: async (p) => {
      await p.waitForSelector(".settings-grid", { timeout: 30_000 });
      await p.waitForTimeout(1_500);
    },
    fullPage: true,
  },
  // Optional
  {
    filename: "07-signals.png",
    route: "/signals",
    description: "Signals — live detector feed",
    prepare: async (p) => {
      await p.waitForSelector(".panel-header", { timeout: 30_000 });
      await p.waitForTimeout(1_500);
    },
    fullPage: true,
  },
];

const MOBILE_SHOT: Shot = {
  filename: "08-mobile.png",
  route: "/heatmap",
  description: "Liquidity Chart on a mobile viewport (Pixel 5)",
  prepare: async (p) => {
    await p.waitForTimeout(10_000);
  },
  fullPage: true,
};

function parseArgs(): { base: string } {
  let base = "http://localhost:3000";
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--base=")) base = a.slice("--base=".length);
  }
  return { base };
}

async function captureDesktop(browser: Browser, base: string, outDir: string): Promise<void> {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  const page = await ctx.newPage();
  for (const shot of SHOTS) {
    const url = `${base}${shot.route}`;
    console.log(`→ ${shot.filename}  ${url}`);
    await page.goto(url, { waitUntil: "networkidle" });
    if (shot.prepare) {
      try {
        await shot.prepare(page);
      } catch (err) {
        console.warn(`  prepare warning for ${shot.filename}: ${(err as Error).message}`);
      }
    }
    await page.screenshot({ path: join(outDir, shot.filename), fullPage: shot.fullPage ?? true });
  }
  await ctx.close();
}

async function captureMobile(browser: Browser, base: string, outDir: string): Promise<void> {
  const pixel = devices["Pixel 5"];
  if (!pixel) {
    console.warn("Pixel 5 device descriptor missing; skipping mobile shot");
    return;
  }
  const ctx = await browser.newContext({ ...pixel });
  const page = await ctx.newPage();
  await page.goto(`${base}${MOBILE_SHOT.route}`, { waitUntil: "networkidle" });
  if (MOBILE_SHOT.prepare) await MOBILE_SHOT.prepare(page);
  await page.screenshot({
    path: join(outDir, MOBILE_SHOT.filename),
    fullPage: MOBILE_SHOT.fullPage ?? true,
  });
  console.log(`→ ${MOBILE_SHOT.filename}  ${base}${MOBILE_SHOT.route}  (Pixel 5)`);
  await ctx.close();
}

async function main(): Promise<void> {
  const { base } = parseArgs();
  const outDir = join(process.cwd(), "docs", "screenshots");
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  try {
    await captureDesktop(browser, base, outDir);
    await captureMobile(browser, base, outDir);
  } finally {
    await browser.close();
  }
  console.log(`Done. Screenshots in ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
