import { browserManager } from "../browser/index.js";
import {
  isStreamUrl,
  extractVideoSrcFromDom,
  readCapturedStreams,
  readCapturedSources,
} from "../browser/adblock.js";
import { logger } from "../utils/logger.js";
import { searchTmdb } from "./tmdb.js";
import type { Provider, SearchResult, Stream } from "./types.js";

// vidsrc.to is dead (domain churn from legal pressure). vidsrc.pro now
// redirects to embed.su, so we use that directly. Also try vidsrc.to as a
// secondary fallback since it sometimes comes back.
const NAME = "vidsrc";
const EMBED_BASES = [
  "https://embed.su/embed",
  "https://vidsrc.to/embed",
];
const NAV_TIMEOUT = 20_000;
const STREAM_WAIT_MS = 30_000;
const POLL_INTERVAL_MS = 750;

export const vidsrcProvider: Provider = {
  name: NAME,

  async search(query: string): Promise<SearchResult[]> {
    return searchTmdb(query, NAME);
  },

  async getStreams(result: SearchResult): Promise<Stream[]> {
    for (const base of EMBED_BASES) {
      const streams = await tryEmbed(base, result);
      if (streams.length > 0) return streams;
    }
    return [];
  },
};

async function tryEmbed(base: string, result: SearchResult): Promise<Stream[]> {
  const sink: string[] = [];
  const page = await browserManager.newRawPage(sink);
  const embedUrl =
    result.type === "series"
      ? `${base}/tv/${result.id}/${result.season ?? 1}/${result.episode ?? 1}`
      : `${base}/movie/${result.id}`;
  try {
    logger.debug("Opening embed:", embedUrl);
    await page.goto(embedUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });

    await page.waitForSelector("video, iframe", { timeout: 15_000 }).catch(() => {
      logger.debug("No video/iframe after 15s on", base);
    });

    await page.mouse.click(640, 360).catch(() => {});

    // Poll all capture layers.
    const start = Date.now();
    while (Date.now() - start < STREAM_WAIT_MS) {
      const all = await collectAll(sink, page);
      if (all.length > 0) {
        logger.debug(`Found ${all.length} stream(s) from ${base}`);
        return all;
      }
      await page.waitForTimeout(POLL_INTERVAL_MS);
    }

    // Last-ditch attempt.
    return collectAll(sink, page);
  } catch (err) {
    logger.debug(`${base} stream extraction failed:`, err);
    return [];
  } finally {
    await page.context().close().catch(() => {});
  }
}

async function collectAll(
  networkSink: string[],
  page: import("playwright").Page,
): Promise<Stream[]> {
  const seen = new Set<string>();
  const streams: Stream[] = [];

  const add = (url: string, quality: string): void => {
    if (seen.has(url)) return;
    seen.add(url);
    streams.push({
      url,
      quality,
      referer: page.url(),
      isM3U8: url.includes(".m3u8"),
    });
  };

  // JS-level sources (from JSON.parse intercept)
  const sources = await readCapturedSources(page);
  for (const s of sources) add(s.url, s.quality);

  // JS-level stream URLs (from fetch/XHR intercept)
  const jsStreams = await readCapturedStreams(page);
  for (const u of jsStreams) {
    const q = u.match(/(\d{3,4})p/);
    add(u, q?.[1] ? `${q[1]}p` : "unknown");
  }

  // Network-level sink
  for (const u of networkSink) {
    if (isStreamUrl(u)) {
      const q = u.match(/(\d{3,4})p/);
      add(u, q?.[1] ? `${q[1]}p` : "unknown");
    }
  }

  // DOM inspection
  const domUrls = await extractVideoSrcFromDom(page);
  for (const u of domUrls) {
    if (isStreamUrl(u)) {
      const q = u.match(/(\d{3,4})p/);
      add(u, q?.[1] ? `${q[1]}p` : "unknown");
    }
  }

  return streams;
}
