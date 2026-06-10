import type { Extractor } from "./index.js";
import type { Stream } from "../types.js";
import { logger } from "../../utils/logger.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * Streamtape hides the real video URL in two spans that must be concatenated
 * and have a leading fragment trimmed. We rebuild it from the page HTML.
 */
export const streamtapeExtractor: Extractor = {
  name: "streamtape",

  canHandle(url: string): boolean {
    return /streamtape\.(com|net|to|xyz|site)/.test(url);
  },

  async extract(url: string): Promise<Stream[]> {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) return [];
      const html = await res.text();

      // The token lives in a script like: ...substring(... 'token=xxx'...).
      const match = html.match(/id=["']?robotlink["']?[^>]*>([^<]+)<\/[^>]*>\s*\+\s*\(['"]([^'"]+)['"]\)/);
      let videoUrl: string | null = null;

      if (match?.[1] && match?.[2]) {
        const first = match[1].replace(/^[^=]*=/, "").trim();
        const second = match[2].replace(/^[^=]*=/, "").substring(0);
        videoUrl = `https:${first}${second}`;
      } else {
        // Generic fallback: look for a get_video endpoint.
        const alt = html.match(/(\/\/[^"'\s]+\/get_video\?[^"'\s]+)/);
        if (alt?.[1]) videoUrl = `https:${alt[1]}`;
      }

      if (!videoUrl) return [];
      return [{ url: videoUrl, quality: "unknown", referer: url, isM3U8: false }];
    } catch (err) {
      logger.debug("streamtape extract failed:", err);
      return [];
    }
  },
};
