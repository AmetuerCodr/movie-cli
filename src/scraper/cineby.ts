import * as cheerio from "cheerio";
import type { Page } from "playwright";
import { browserManager } from "../browser/index.js";
import { isStreamUrl } from "../browser/adblock.js";
import { logger } from "../utils/logger.js";
import type { Provider, SearchResult, Stream } from "./types.js";

const BASE = "https://cineby.rs";
const NAME = "cineby";
const NAV_TIMEOUT = 15_000;

/**
 * Primary provider backed by cineby.rs. Search prefers the site's JSON API and
 * falls back to scraping rendered HTML. Stream extraction drives a real
 * browser and captures media URLs off the network.
 */
export const cinebyProvider: Provider = {
  name: NAME,

  async search(query: string): Promise<SearchResult[]> {
    const viaApi = await searchViaApi(query);
    if (viaApi.length > 0) return viaApi;
    logger.debug("cineby API search empty, falling back to DOM scrape");
    return searchViaDom(query);
  },

  async getStreams(result: SearchResult): Promise<Stream[]> {
    return extractStreams(result);
  },
};

interface ApiItem {
  id?: number | string;
  tmdb_id?: number | string;
  title?: string;
  name?: string;
  year?: number | string;
  release_date?: string;
  first_air_date?: string;
  media_type?: string;
  type?: string;
  vote_average?: number;
  rating?: number;
  poster_path?: string;
  poster?: string;
  slug?: string;
}

async function searchViaApi(query: string): Promise<SearchResult[]> {
  const endpoints = [
    `${BASE}/api/search?q=${encodeURIComponent(query)}`,
    `${BASE}/api/search?query=${encodeURIComponent(query)}`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetchWithRetry(url, {
        headers: { Accept: "application/json", "User-Agent": browserUa() },
      });
      if (!res.ok) continue;
      const data: unknown = await res.json();
      const items = extractApiItems(data);
      if (items.length > 0) {
        return items.map((item) => normalizeApiItem(item)).filter(Boolean) as SearchResult[];
      }
    } catch (err) {
      logger.debug("cineby API endpoint failed:", url, err);
    }
  }
  return [];
}

function extractApiItems(data: unknown): ApiItem[] {
  if (Array.isArray(data)) return data as ApiItem[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const key of ["results", "data", "items", "movies"]) {
      if (Array.isArray(obj[key])) return obj[key] as ApiItem[];
    }
  }
  return [];
}

function normalizeApiItem(item: ApiItem): SearchResult | null {
  const title = item.title ?? item.name;
  if (!title) return null;

  const rawType = (item.media_type ?? item.type ?? "movie").toLowerCase();
  const type: SearchResult["type"] = rawType.includes("tv") || rawType.includes("series") ? "series" : "movie";

  const dateStr = item.release_date ?? item.first_air_date ?? null;
  let year: number | null = item.year != null ? Number(item.year) : null;
  if ((year == null || Number.isNaN(year)) && dateStr) {
    const parsed = Number(dateStr.slice(0, 4));
    year = Number.isNaN(parsed) ? null : parsed;
  }
  if (year != null && Number.isNaN(year)) year = null;

  const ratingRaw = item.vote_average ?? item.rating ?? null;
  const rating = ratingRaw != null ? Number(ratingRaw) : null;

  const id = String(item.id ?? item.tmdb_id ?? item.slug ?? title);

  let poster: string | null = item.poster ?? null;
  if (!poster && item.poster_path) {
    poster = item.poster_path.startsWith("http")
      ? item.poster_path
      : `https://image.tmdb.org/t/p/w500${item.poster_path}`;
  }

  return {
    id,
    title,
    year,
    type,
    rating: rating != null && !Number.isNaN(rating) ? rating : null,
    poster,
    provider: NAME,
  };
}

async function searchViaDom(query: string): Promise<SearchResult[]> {
  const sink: string[] = [];
  const page = await browserManager.newPage(sink);
  try {
    const url = `${BASE}/search?query=${encodeURIComponent(query)}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    // Give client-rendered results a moment to populate.
    await page
      .waitForSelector(".movie-item, [class*='card'], a[href*='/movie/'], a[href*='/tv/']", {
        timeout: NAV_TIMEOUT,
      })
      .catch(() => logger.debug("cineby result selector timed out"));

    const html = await page.content();
    return parseSearchHtml(html);
  } catch (err) {
    logger.debug("cineby DOM search failed:", err);
    return [];
  } finally {
    await page.context().close().catch(() => {});
  }
}

function parseSearchHtml(html: string): SearchResult[] {
  const $ = cheerio.load(html);
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  const selectors = [".movie-item", "[class*='card']", "a[href*='/movie/']", "a[href*='/tv/']"];
  for (const selector of selectors) {
    $(selector).each((_, el) => {
      const node = $(el);
      const href = node.is("a") ? node.attr("href") : node.find("a").attr("href");
      if (!href) return;

      const id = href.startsWith("http") ? href : `${BASE}${href}`;
      if (seen.has(id)) return;

      const title =
        node.attr("title") ??
        node.find("[class*='title'], h2, h3").first().text().trim() ??
        node.text().trim();
      if (!title) return;

      seen.add(id);
      const yearMatch = node.text().match(/\b(19|20)\d{2}\b/);
      const type: SearchResult["type"] = href.includes("/tv/") ? "series" : "movie";

      results.push({
        id,
        title: title.slice(0, 120),
        year: yearMatch ? Number(yearMatch[0]) : null,
        type,
        rating: null,
        poster: node.find("img").attr("src") ?? null,
        provider: NAME,
      });
    });
    if (results.length > 0) break;
  }
  return results;
}

async function extractStreams(result: SearchResult): Promise<Stream[]> {
  const sink: string[] = [];
  const page = await browserManager.newPage(sink);
  try {
    const detailUrl = result.id.startsWith("http") ? result.id : `${BASE}/movie/${result.id}`;
    logger.debug("Navigating to detail page:", detailUrl);
    await page.goto(detailUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });

    // Step into any embed iframe so its network traffic runs through our sink.
    await followEmbedIframe(page, sink);

    // Wait for a media URL to appear on the wire.
    await waitForStream(sink, 15_000);

    return await buildStreams(sink, detailUrl);
  } catch (err) {
    logger.debug("cineby stream extraction failed:", err);
    return buildStreams(sink, BASE);
  } finally {
    await page.context().close().catch(() => {});
  }
}

async function followEmbedIframe(page: Page, sink: string[]): Promise<void> {
  try {
    const iframeSrc = await page
      .waitForSelector("iframe[src]", { timeout: NAV_TIMEOUT })
      .then((handle) => handle?.getAttribute("src"))
      .catch(() => null);

    if (!iframeSrc) return;
    const embedUrl = iframeSrc.startsWith("http") ? iframeSrc : `https:${iframeSrc}`;
    logger.debug("Following embed iframe:", embedUrl);

    const embedPage = await browserManager.newPage(sink);
    try {
      await embedPage.goto(embedUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
      // Trigger the player; many embeds start loading the stream on click.
      await embedPage.mouse.click(640, 360).catch(() => {});
      await waitForStream(sink, 10_000);
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
    const tick = () => {
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
    streams.push({
      url,
      quality: guessQuality(url),
      referer,
      isM3U8,
    });
  }
  return dedupeStreams(streams);
}

async function parseM3U8Variants(masterUrl: string, referer: string): Promise<Stream[]> {
  try {
    const res = await fetchWithRetry(masterUrl, {
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

interface RetryInit {
  headers?: Record<string, string>;
}

async function fetchWithRetry(url: string, init: RetryInit = {}, retries = 1): Promise<Response> {
  const delays = [1000, 2000];
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, delays[attempt] ?? 2000));
      }
    }
  }
  throw lastErr;
}
