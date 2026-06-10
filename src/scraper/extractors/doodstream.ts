import type { Extractor } from "./index.js";
import type { Stream } from "../types.js";
import { logger } from "../../utils/logger.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * Doodstream builds a one-time download URL by appending a random token plus a
 * fixed expiry suffix to a "pass_md5" path. We fetch that path and assemble the
 * final URL the way the site's own JS does.
 */
export const doodstreamExtractor: Extractor = {
  name: "doodstream",

  canHandle(url: string): boolean {
    return /dood\.(stream|to|so|watch|la|ws|cx|sh|pm|yt|wf|re|li)|doodstream/.test(url);
  },

  async extract(url: string): Promise<Stream[]> {
    try {
      const host = new URL(url).origin;
      const res = await fetch(url, { headers: { "User-Agent": UA, Referer: url } });
      if (!res.ok) return [];
      const html = await res.text();

      const pass = html.match(/\/pass_md5\/[^"'\s]+/);
      if (!pass?.[0]) return [];

      const tokenMatch = pass[0].match(/\/pass_md5\/[^/]+\/([^"'\s/]+)/);
      const token = tokenMatch?.[1] ?? "";

      const passRes = await fetch(`${host}${pass[0]}`, {
        headers: { "User-Agent": UA, Referer: url },
      });
      if (!passRes.ok) return [];
      const base = (await passRes.text()).trim();

      const random = randomString(10);
      const expiry = Date.now();
      const videoUrl = `${base}${random}?token=${token}&expiry=${expiry}`;

      return [{ url: videoUrl, quality: "unknown", referer: host, isM3U8: false }];
    } catch (err) {
      logger.debug("doodstream extract failed:", err);
      return [];
    }
  },
};

function randomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}
