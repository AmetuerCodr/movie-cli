import { PlaywrightBlocker } from "@cliqz/adblocker-playwright";
import type { Page } from "playwright";
import fetch from "node-fetch";
import { logger } from "../utils/logger.js";

let cached: PlaywrightBlocker | null = null;

/**
 * Build (and memoize) a PlaywrightBlocker loaded with the prebuilt ads and
 * tracking filter lists.
 */
export async function getBlocker(): Promise<PlaywrightBlocker> {
  if (cached) return cached;
  logger.debug("Loading adblock filter lists...");
  // node-fetch's signature differs slightly from the DOM fetch the lib expects;
  // it is compatible at runtime, so cast through unknown.
  cached = await PlaywrightBlocker.fromPrebuiltAdsAndTracking(
    fetch as unknown as typeof globalThis.fetch,
  );
  logger.debug("Adblock filter lists loaded");
  return cached;
}

/**
 * Apply ad blocking and aggressive resource trimming to a page. Captured
 * stream URLs are pushed into `streamSink` as they are observed.
 */
export async function applyAdblock(page: Page, streamSink: string[]): Promise<void> {
  const blocker = await getBlocker();
  await blocker.enableBlockingInPage(page);

  // Close popups the moment they open.
  page.on("popup", (popup) => {
    logger.debug("Closing popup:", popup.url());
    popup.close().catch(() => {});
  });

  // Capture media stream URLs as they fly past.
  page.on("request", (req) => {
    const url = req.url();
    if (isStreamUrl(url)) {
      logger.debug("Captured candidate stream:", url);
      if (!streamSink.includes(url)) streamSink.push(url);
    }
  });

  // Trim heavy, non-essential resources, but never block the video stream.
  await page.route("**/*", (route) => {
    const req = route.request();
    const type = req.resourceType();
    const url = req.url();

    if (isStreamUrl(url)) {
      route.continue().catch(() => {});
      return;
    }

    if (type === "image" || type === "media" || type === "font") {
      route.abort().catch(() => {});
      return;
    }

    route.continue().catch(() => {});
  });
}

export function isStreamUrl(url: string): boolean {
  return (
    url.includes(".m3u8") ||
    url.includes(".mp4") ||
    /\.ts(\?|$)/.test(url) ||
    /\/hls\/|\/dash\//.test(url)
  );
}
