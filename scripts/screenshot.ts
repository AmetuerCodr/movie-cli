/**
 * Takes screenshots of the web UI for review.
 * Usage: bun run scripts/screenshot.ts
 */
import { chromium } from "playwright";
import { startServer, DEFAULT_PORT } from "../src/web/server.ts";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dir, "..");

const { close, port } = await startServer(DEFAULT_PORT);
const url = `http://localhost:${port}`;

console.log(`Server up at ${url} — launching browser…`);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

// ── Home screen ───────────────────────────────────────────
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForSelector(".movie-card", { timeout: 20_000 }).catch(() => {});
await page.waitForTimeout(800);

const homeShot = join(OUT_DIR, "screenshot-home.png");
await page.screenshot({ path: homeShot, fullPage: false });
console.log("✓ Home screenshot:", homeShot);

// ── Full-page home scroll ─────────────────────────────────
const fullShot = join(OUT_DIR, "screenshot-full.png");
await page.screenshot({ path: fullShot, fullPage: true });
console.log("✓ Full-page screenshot:", fullShot);

// ── Search screen ─────────────────────────────────────────
await page.fill("#search-input", "inception");
await page.waitForSelector("#search-grid .movie-card", { timeout: 15_000 }).catch(() => {});
await page.waitForTimeout(800);

const searchShot = join(OUT_DIR, "screenshot-search.png");
await page.screenshot({ path: searchShot, fullPage: false });
console.log("✓ Search screenshot:", searchShot);

await browser.close();
close();
console.log("Done.");
