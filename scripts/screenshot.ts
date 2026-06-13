/**
 * Takes screenshots of the web UI for review.
 * Usage: bun run scripts/screenshot.ts
 */
import { chromium } from "playwright";
import { startServer, DEFAULT_PORT } from "../src/web/server.ts";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, "..");

const { close, port } = await startServer(DEFAULT_PORT);
const base = `http://localhost:${port}`;
console.log(`Server at ${base}`);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 860 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

async function waitForImages(timeout = 30_000) {
  await page.waitForFunction(
    () => {
      const imgs = Array.from(document.querySelectorAll<HTMLImageElement>("img[src]"));
      if (imgs.length === 0) return false;
      return imgs.every((img) => img.complete && img.naturalWidth > 0);
    },
    { timeout },
  );
}

// ── Home ─────────────────────────────────────────────────
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForSelector(".card", { timeout: 20_000 });
await waitForImages(30_000).catch(() => console.log("  (some images still pending, proceeding)"));
await page.waitForTimeout(300);

await page.screenshot({ path: join(OUT, "screenshot-home.png") });
console.log("✓ screenshot-home.png");

// ── Full page ─────────────────────────────────────────────
await page.screenshot({ path: join(OUT, "screenshot-full.png"), fullPage: true });
console.log("✓ screenshot-full.png");

// ── Search ────────────────────────────────────────────────
await page.fill("#search-input", "inception");
// Wait for search results view (which has the .search-bar header + grid)
await page.waitForSelector(".search-bar", { timeout: 15_000 });
await page.waitForSelector(".grid .card", { timeout: 10_000 });
await waitForImages(25_000).catch(() => console.log("  (some search images still pending)"));
await page.waitForTimeout(400);

await page.screenshot({ path: join(OUT, "screenshot-search.png") });
console.log("✓ screenshot-search.png");

await browser.close();
close();
console.log("Done.");
