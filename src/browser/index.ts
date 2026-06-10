import { chromium, type Browser, type Page } from "playwright";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { applyAdblock } from "./adblock.js";
import { logger } from "../utils/logger.js";

const require = createRequire(import.meta.url);

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * Singleton wrapper around a Playwright Chromium browser with ad blocking
 * baked into every page it hands out.
 */
export class BrowserManager {
  private browser: Browser | null = null;
  private headless = true;

  async init(headless: boolean): Promise<void> {
    if (this.browser) return;
    this.headless = headless;

    try {
      this.browser = await chromium.launch({ headless });
    } catch (err) {
      // Most common cause: the Chromium build is not installed yet.
      logger.debug("Initial chromium launch failed:", err);
      ensureChromiumInstalled();
      this.browser = await chromium.launch({ headless });
    }
  }

  /**
   * Open a fresh page. Captured stream URLs are appended to `streamSink`.
   */
  async newPage(streamSink: string[]): Promise<Page> {
    if (!this.browser) {
      throw new Error("BrowserManager.init() must be called before newPage()");
    }
    const context = await this.browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();
    await applyAdblock(page, streamSink);
    return page;
  }

  async close(): Promise<void> {
    if (this.browser) {
      logger.debug("Closing browser");
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }
}

let installAttempted = false;

/**
 * Run `playwright install chromium` once if the browser binary is missing.
 */
export function ensureChromiumInstalled(): void {
  if (installAttempted) return;
  installAttempted = true;
  console.log("Installing browser for scraping (first run only)…");
  const result = spawnSync(
    process.execPath,
    [require.resolve("playwright/cli"), "install", "chromium", "--with-deps"],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    // Fall back to the plain install without system deps (no root needed).
    spawnSync(
      process.execPath,
      [require.resolve("playwright/cli"), "install", "chromium"],
      { stdio: "inherit" },
    );
  }
}

// Shared instance used across the app.
export const browserManager = new BrowserManager();
