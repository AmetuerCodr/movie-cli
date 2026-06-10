import { browserManager } from "../browser/index.js";
import {
  isStreamUrl,
  extractVideoSrcFromDom,
  readCapturedStreams,
  readCapturedSources,
  readDecryptedPayloads,
  readRawResponses,
} from "../browser/adblock.js";
import { logger } from "../utils/logger.js";
import { searchTmdb } from "./tmdb.js";
import type { Provider, SearchResult, Stream } from "./types.js";

const NAME = "cineby";
const PLAYER_BASE = "https://player.videasy.to";
const PLAYER_ORIGIN = "https://player.videasy.to/";
const NAV_TIMEOUT = 30_000;
// Videasy's player auto-selects a server, calls its encrypted API, decrypts
// via WASM + CryptoJS AES, and starts HLS playback. The full chain can take
// 10-25s on a cold load.
const STREAM_WAIT_MS = 45_000;
const POLL_INTERVAL_MS = 750;

export const cinebyProvider: Provider = {
  name: NAME,

  async search(query: string): Promise<SearchResult[]> {
    return searchTmdb(query, NAME);
  },

  async getStreams(result: SearchResult): Promise<Stream[]> {
    return extractStreams(result);
  },
};

function playerUrl(result: SearchResult): string {
  if (result.type === "series") {
    return `${PLAYER_BASE}/tv/${result.id}/1/1`;
  }
  return `${PLAYER_BASE}/movie/${result.id}`;
}

async function extractStreams(result: SearchResult): Promise<Stream[]> {
  const sink: string[] = [];
  // Use a RAW page (no adblocker) — the Cliqz filter lists block
  // api.videasy.to and/or the WASM module, killing the player before it can
  // decrypt any stream sources. The raw page still has JS-level interception
  // (fetch/XHR/JSON.parse patches) injected via addInitScript.
  const page = await browserManager.newRawPage(sink);
  const url = playerUrl(result);
  try {
    logger.debug("Opening videasy player:", url);

    // Forward page console messages so --debug shows JS errors from the player.
    page.on("console", (msg) => {
      logger.debug(`[page:${msg.type()}]`, msg.text());
    });

    // Intercept api.videasy.to source calls at the Playwright network level.
    // This tells us (a) whether the API is being reached and (b) response status.
    await page.route("**/sources-with-title**", async (route) => {
      logger.debug("videasy sources API →", route.request().url());
      const response = await route.fetch();
      logger.debug("videasy sources API status:", response.status());
      await route.fulfill({ response });
    });

    // Navigate with cineby.at as referer — the player may validate its embedding origin.
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT,
      referer: "https://cineby.at/",
    });

    // The videasy player is a Next.js SPA. After hydration it:
    //   1. Fetches movie metadata from db.videasy.to
    //   2. Calls api.videasy.to/{server}/sources-with-title (may try multiple servers)
    //   3. Decrypts the response (WASM + CryptoJS AES) — our CryptoJS patch fires here
    //   4. JSON.parse's the decrypted payload → our JSON.parse patch also fires
    //   5. Feeds the URL to HLS.js → fetch/XHR patches capture the .m3u8 request
    //
    // NOTE: the player does NOT render a plain <video> element by the time we capture
    // the stream (CryptoJS fires first). Waiting for a video selector just blocks.
    // Instead, give the page a short window to hydrate, click to nudge autoplay,
    // then start polling immediately via waitForStream.
    await page.waitForTimeout(2_000);
    await page.mouse.click(640, 360).catch(() => {});

    // Poll for stream URLs from all capture layers.
    const found = await waitForStream(sink, page, STREAM_WAIT_MS);

    return await buildStreams(found, PLAYER_ORIGIN);
  } catch (err) {
    logger.debug("cineby stream extraction failed:", err);
    // Still try to return anything we caught before the error.
    const partial = await collectAllUrls(sink, page);
    return buildStreams(partial, PLAYER_ORIGIN);
  } finally {
    await page.context().close().catch(() => {});
  }
}

/**
 * Collect stream URLs from all capture layers into a single list.
 */
async function collectAllUrls(
  networkSink: string[],
  page: import("playwright").Page,
): Promise<Array<{ url: string; quality: string }>> {
  const results: Array<{ url: string; quality: string }> = [];
  const seen = new Set<string>();

  const add = (url: string, quality: string): void => {
    if (seen.has(url)) return;
    seen.add(url);
    results.push({ url, quality });
  };

  // 1. JS-level captured sources (best: gives us URL + quality from decrypted JSON)
  const sources = await readCapturedSources(page);
  for (const s of sources) add(s.url, s.quality);

  // 2. JS-level captured stream URLs (from fetch/XHR patches)
  const jsStreams = await readCapturedStreams(page);
  for (const u of jsStreams) add(u, guessQuality(u));

  // 3. Network-level sink (Playwright request events)
  for (const u of networkSink) {
    if (isStreamUrl(u)) add(u, guessQuality(u));
  }

  // 4. DOM inspection (video element src/currentSrc)
  const domUrls = await extractVideoSrcFromDom(page);
  for (const u of domUrls) {
    if (isStreamUrl(u)) add(u, guessQuality(u));
  }

  return results;
}

/**
 * Poll until at least one stream URL is found (via any capture layer),
 * or until the timeout expires.
 */
async function waitForStream(
  networkSink: string[],
  page: import("playwright").Page,
  timeoutMs: number,
): Promise<Array<{ url: string; quality: string }>> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const all = await collectAllUrls(networkSink, page);
    if (all.length > 0) {
      logger.debug(`Found ${all.length} stream(s) after ${Date.now() - start}ms`);
      return all;
    }
    await page.waitForTimeout(POLL_INTERVAL_MS);
  }
  logger.debug("Stream wait timed out after", timeoutMs, "ms — dumping diagnostic state");
  const decrypted = await readDecryptedPayloads(page);
  const raw = await readRawResponses(page);
  logger.debug(`Decrypted CryptoJS payloads captured: ${decrypted.length}`);
  for (const d of decrypted) logger.debug("  decrypted:", d.substring(0, 300));
  logger.debug(`Raw API response snippets captured: ${raw.length}`);
  for (const r of raw) logger.debug(`  ${r.url} → ${r.snippet.substring(0, 150)}`);
  return collectAllUrls(networkSink, page);
}

async function buildStreams(
  found: Array<{ url: string; quality: string }>,
  referer: string,
): Promise<Stream[]> {
  if (found.length === 0) return [];

  const streams: Stream[] = [];
  for (const { url, quality } of found) {
    const isM3U8 = url.includes(".m3u8");
    if (isM3U8) {
      const variants = await parseM3U8Variants(url, referer);
      if (variants.length > 0) {
        streams.push(...variants);
        continue;
      }
    }
    streams.push({ url, quality, referer, isM3U8 });
  }
  return dedupeStreams(streams);
}

async function parseM3U8Variants(masterUrl: string, referer: string): Promise<Stream[]> {
  try {
    const res = await globalThis.fetch(masterUrl, {
      headers: { Referer: referer, "User-Agent": browserUa() },
    });
    if (!res.ok) return [];
    const text = await res.text();
    if (!text.includes("#EXT-X-STREAM-INF")) return [];

    const lines = text.split(/\r?\n/);
    const variants: Stream[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line || !line.startsWith("#EXT-X-STREAM-INF")) continue;
      const next = lines[i + 1]?.trim();
      if (!next || next.startsWith("#")) continue;

      const resMatch = line.match(/RESOLUTION=\d+x(\d+)/);
      const quality = resMatch?.[1] ? `${resMatch[1]}p` : "unknown";
      const variantUrl = next.startsWith("http") ? next : resolveRelative(masterUrl, next);
      variants.push({ url: variantUrl, quality, referer, isM3U8: true });
    }
    return variants;
  } catch (err) {
    logger.debug("Failed to parse m3u8 master:", err);
    return [];
  }
}

function resolveRelative(base: string, rel: string): string {
  try {
    return new URL(rel, base).toString();
  } catch {
    return rel;
  }
}

function guessQuality(url: string): string {
  const match = url.match(/(\d{3,4})p/);
  return match?.[1] ? `${match[1]}p` : "unknown";
}

function dedupeStreams(streams: Stream[]): Stream[] {
  const seen = new Set<string>();
  return streams.filter((s) => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });
}

function browserUa(): string {
  return (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
  );
}
