import type { Page } from "playwright";
import { browserManager } from "../browser/index.js";
import { isStreamUrl } from "../browser/adblock.js";
import { logger } from "../utils/logger.js";
import { searchTmdb } from "./tmdb.js";
import type { Provider, SearchResult, Stream } from "./types.js";

// cineby.rs is dead; the project now lives at cineby.at (cineby.app redirects
// here). Search data is served by an open TMDB mirror, and playback happens on
// the /watch/{type}/{id} route which loads an HLS stream we capture.
const BASE = "https://www.cineby.at";
const NAME = "cineby";
const NAV_TIMEOUT = 15_000;

/**
 * Primary provider. Search is a keyless TMDB lookup (fast, no browser).
 * Stream extraction drives a real browser against the cineby watch page and
 * captures the media URL off the network.
 */
export const cinebyProvider: Provider = {
  name: NAME,

  async search(query: string): Promise<SearchResult[]> {
    return searchTmdb(query, NAME);
  },

  async getStreams(result: SearchResult): Promise<Stream[]> {
    return extractStreams(result);
  },
};

function watchUrl(result: SearchResult): string {
  // Movies: /watch/movie/{id}. Series default to S1E1 (episode picking is a
  // future enhancement); the path shape is /watch/tv/{id}/{season}/{episode}.
  if (result.type === "series") {
    return `${BASE}/watch/tv/${result.id}/1/1`;
  }
  return `${BASE}/watch/movie/${result.id}`;
}

async function extractStreams(result: SearchResult): Promise<Stream[]> {
  const sink: string[] = [];
  const page = await browserManager.newPage(sink);
  const url = watchUrl(result);
  try {
    logger.debug("Navigating to watch page:", url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });

    // Kick the player and step into any embed iframe so its traffic is seen.
    await page.mouse.click(640, 360).catch(() => {});
    await followEmbedIframe(page, sink);
    await waitForStream(sink, 20_000);

    return await buildStreams(sink, url);
  } catch (err) {
    logger.debug("cineby stream extraction failed:", err);
    return buildStreams(sink, url);
  } finally {
    await page.context().close().catch(() => {});
  }
}

async function followEmbedIframe(page: Page, sink: string[]): Promise<void> {
  try {
    const handle = await page.waitForSelector("iframe[src]", { timeout: 8000 }).catch(() => null);
    const iframeSrc = handle ? await handle.getAttribute("src") : null;
    if (!iframeSrc) return;

    const embedUrl = iframeSrc.startsWith("http") ? iframeSrc : `https:${iframeSrc}`;
    logger.debug("Following embed iframe:", embedUrl);

    const embedPage = await browserManager.newPage(sink);
    try {
      await embedPage.goto(embedUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
      await embedPage.mouse.click(640, 360).catch(() => {});
      await waitForStream(sink, 12_000);
    } finally {
      await embedPage.context().close().catch(() => {});
    }
  } catch (err) {
    logger.debug("Embed iframe follow failed:", err);
  }
}

function waitForStream(sink: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = (): void => {
      if (sink.length > 0 || Date.now() - start > timeoutMs) {
        resolve();
        return;
      }
      setTimeout(tick, 250);
    };
    tick();
  });
}

async function buildStreams(sink: string[], referer: string): Promise<Stream[]> {
  const unique = [...new Set(sink.filter(isStreamUrl))];
  if (unique.length === 0) return [];

  const streams: Stream[] = [];
  for (const url of unique) {
    const isM3U8 = url.includes(".m3u8");
    if (isM3U8) {
      const variants = await parseM3U8Variants(url, referer);
      if (variants.length > 0) {
        streams.push(...variants);
        continue;
      }
    }
    streams.push({ url, quality: guessQuality(url), referer, isM3U8 });
  }
  return dedupeStreams(streams);
}

async function parseM3U8Variants(masterUrl: string, referer: string): Promise<Stream[]> {
  try {
    const res = await fetch(masterUrl, {
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
