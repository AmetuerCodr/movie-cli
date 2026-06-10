import { browserManager } from "../browser/index.js";
import { isStreamUrl } from "../browser/adblock.js";
import { readConfig } from "../utils/config.js";
import { logger } from "../utils/logger.js";
import type { Provider, SearchResult, Stream } from "./types.js";

const NAME = "vidsrc";
const EMBED_BASE = "https://vidsrc.to/embed/movie";
const NAV_TIMEOUT = 15_000;

// TMDB's public demo key works for read-only search. Users can override it in
// config (tmdbApiKey) to avoid shared rate limits.
const DEMO_TMDB_KEY = "8d6d91941230817f7807d643736e8a49";

/**
 * Fallback provider. Search is powered by TMDB; streams are extracted by
 * driving vidsrc.to's embed player and capturing the HLS URL off the network.
 */
export const vidsrcProvider: Provider = {
  name: NAME,

  async search(query: string): Promise<SearchResult[]> {
    const config = await readConfig();
    const key = config.tmdbApiKey ?? DEMO_TMDB_KEY;
    const url =
      `https://api.themoviedb.org/3/search/movie?api_key=${key}` +
      `&query=${encodeURIComponent(query)}&include_adult=false`;

    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) {
        logger.debug("TMDB search returned", res.status);
        return [];
      }
      const data = (await res.json()) as { results?: TmdbMovie[] };
      const results = data.results ?? [];
      return results.map((m) => normalize(m));
    } catch (err) {
      logger.debug("vidsrc/TMDB search failed:", err);
      return [];
    }
  },

  async getStreams(result: SearchResult): Promise<Stream[]> {
    const sink: string[] = [];
    const page = await browserManager.newPage(sink);
    const embedUrl = `${EMBED_BASE}/${result.id}`;
    try {
      logger.debug("Opening vidsrc embed:", embedUrl);
      await page.goto(embedUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
      await page.mouse.click(640, 360).catch(() => {});

      await new Promise<void>((resolve) => {
        const start = Date.now();
        const tick = () => {
          if (sink.length > 0 || Date.now() - start > 15_000) resolve();
          else setTimeout(tick, 250);
        };
        tick();
      });

      const unique = [...new Set(sink.filter(isStreamUrl))];
      return unique.map((url) => ({
        url,
        quality: url.match(/(\d{3,4})p/)?.[1] ? `${url.match(/(\d{3,4})p/)![1]}p` : "unknown",
        referer: embedUrl,
        isM3U8: url.includes(".m3u8"),
      }));
    } catch (err) {
      logger.debug("vidsrc stream extraction failed:", err);
      return [];
    } finally {
      await page.context().close().catch(() => {});
    }
  },
};

interface TmdbMovie {
  id: number;
  title?: string;
  name?: string;
  release_date?: string;
  vote_average?: number;
  poster_path?: string | null;
}

function normalize(m: TmdbMovie): SearchResult {
  const title = m.title ?? m.name ?? "Untitled";
  const year = m.release_date ? Number(m.release_date.slice(0, 4)) : null;
  return {
    id: String(m.id),
    title,
    year: year != null && !Number.isNaN(year) ? year : null,
    type: "movie",
    rating: m.vote_average ?? null,
    poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
    provider: NAME,
  };
}
