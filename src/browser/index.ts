import { chromium, type Browser, type Page } from "playwright";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { applyAdblock, applyLightCapture } from "./adblock.js";
import { logger } from "../utils/logger.js";

const require = createRequire(import.meta.url);

// Matches a real Chrome 124 on Windows — no "Headless" token, which fingerprinting
// services key on to flag bot traffic.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

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

    // Allow video to autoplay without a user gesture so embed players begin
    // loading their stream as soon as the page mounts.
    const launchOptions = {
      headless,
      args: ["--autoplay-policy=no-user-gesture-required"],
    };

    try {
      this.browser = await chromium.launch(launchOptions);
    } catch (err) {
      // Most common cause: the Chromium build is not installed yet.
      logger.debug("Initial chromium launch failed:", err);
      ensureChromiumInstalled();
      this.browser = await chromium.launch(launchOptions);
    }
  }

  /**
   * Open a fresh page with ad blocking. Captured stream URLs are appended to `streamSink`.
   */
  async newPage(streamSink: string[]): Promise<Page> {
    if (!this.browser) {
      throw new Error("BrowserManager.init() must be called before newPage()");
    }
    const context = await this.browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 720 },
      locale: "en-US",
      timezoneId: "America/New_York",
    });
    const page = await context.newPage();
    await applyAdblock(page, streamSink);
    return page;
  }

  /**
   * Open a page WITHOUT the ad blocker. Essential for sites like videasy whose
   * own API calls get false-positived by filter lists. Stream URLs are still
   * captured via network monitoring.
   */
  async newRawPage(streamSink: string[]): Promise<Page> {
    if (!this.browser) {
      throw new Error("BrowserManager.init() must be called before newRawPage()");
    }
    const context = await this.browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 720 },
      locale: "en-US",
      timezoneId: "America/New_York",
    });
    const page = await context.newPage();
    await applyLightCapture(page, streamSink);
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
 * Playwright's exports map does not expose "playwright/cli", so we locate
 * cli.js relative to its package.json (which is exported).
 */
export function ensureChromiumInstalled(): void {
  if (installAttempted) return;
  installAttempted = true;
  console.log("Installing browser for scraping (first run only)…");

  let cliPath: string;
  try {
    const pkgPath = require.resolve("playwright/package.json");
    cliPath = join(dirname(pkgPath), "cli.js");
  } catch (err) {
    logger.debug("Could not locate playwright package:", err);
    throw installFailure();
  }

  const result = spawnSync(process.execPath, [cliPath, "install", "chromium", "--with-deps"], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    // Fall back to the plain install without system deps (no root needed).
    const plain = spawnSync(process.execPath, [cliPath, "install", "chromium"], {
      stdio: "inherit",
    });
    if (plain.status !== 0) {
      throw installFailure();
    }
  }
}

function installFailure(): Error {
  return new Error(
    "Could not install Playwright's Chromium automatically.\n" +
      "Install it manually and re-run:\n" +
      "  npx playwright install chromium",
  );
}

// Shared instance used across the app.
export const browserManager = new BrowserManager();
