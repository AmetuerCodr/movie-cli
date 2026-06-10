import { browserManager } from "../browser/index.js";
import { isStreamUrl } from "../browser/adblock.js";
import { logger } from "../utils/logger.js";
import { searchTmdb } from "./tmdb.js";
import type { Provider, SearchResult, Stream } from "./types.js";

const NAME = "vidsrc";
const EMBED_MOVIE = "https://vidsrc.to/embed/movie";
const EMBED_TV = "https://vidsrc.to/embed/tv";
const NAV_TIMEOUT = 15_000;

/**
 * Fallback provider. Shares the keyless TMDB search with the primary provider,
 * but extracts streams from vidsrc.to's embed player instead.
 */
export const vidsrcProvider: Provider = {
  name: NAME,

  async search(query: string): Promise<SearchResult[]> {
    return searchTmdb(query, NAME);
  },

  async getStreams(result: SearchResult): Promise<Stream[]> {
    const sink: string[] = [];
    const page = await browserManager.newPage(sink);
    const embedUrl =
      result.type === "series"
        ? `${EMBED_TV}/${result.id}/1/1`
        : `${EMBED_MOVIE}/${result.id}`;
    try {
      logger.debug("Opening vidsrc embed:", embedUrl);
      await page.goto(embedUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
      await page.mouse.click(640, 360).catch(() => {});

      await new Promise<void>((resolve) => {
        const start = Date.now();
        const tick = (): void => {
          if (sink.length > 0 || Date.now() - start > 15_000) resolve();
          else setTimeout(tick, 250);
        };
        tick();
      });

      const unique = [...new Set(sink.filter(isStreamUrl))];
      return unique.map((url) => {
        const q = url.match(/(\d{3,4})p/);
        return {
          url,
          quality: q?.[1] ? `${q[1]}p` : "unknown",
          referer: embedUrl,
          isM3U8: url.includes(".m3u8"),
        };
      });
    } catch (err) {
      logger.debug("vidsrc stream extraction failed:", err);
      return [];
    } finally {
      await page.context().close().catch(() => {});
    }
  },
};
