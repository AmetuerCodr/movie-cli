import type { Extractor } from "./index.js";
import type { Stream } from "../types.js";
import { logger } from "../../utils/logger.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * Mixdrop packs its player config with the standard `eval(function(p,a,c,k,e,d)`
 * obfuscator. We unpack it and pull the wurl/MDCore.wurl entry.
 */
export const mixdropExtractor: Extractor = {
  name: "mixdrop",

  canHandle(url: string): boolean {
    return /mixdrop\.(co|to|club|ch|sx|bz|ps|gl|vc)/.test(url);
  },

  async extract(url: string): Promise<Stream[]> {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) return [];
      const html = await res.text();

      const packed = html.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\)\)/);
      const source = packed?.[0] ? unpack(packed[0]) : html;

      const wurl = source.match(/MDCore\.wurl\s*=\s*["']([^"']+)["']/) ?? source.match(/wurl["']?\s*[:=]\s*["']([^"']+)["']/);
      if (!wurl?.[1]) return [];

      const videoUrl = wurl[1].startsWith("http") ? wurl[1] : `https:${wurl[1]}`;
      return [{ url: videoUrl, quality: "unknown", referer: url, isM3U8: videoUrl.includes(".m3u8") }];
    } catch (err) {
      logger.debug("mixdrop extract failed:", err);
      return [];
    }
  },
};

/**
 * Minimal Dean Edwards p.a.c.k.e.r unpacker — enough to recover string
 * literals from a packed player bootstrap.
 */
function unpack(packed: string): string {
  try {
    const m = packed.match(/}\('(.*)',(\d+),(\d+),'(.*?)'\.split\('\|'\)/s);
    if (!m) return packed;
    let payload = m[1] ?? "";
    const radix = Number(m[2]);
    const count = Number(m[3]);
    const dict = (m[4] ?? "").split("|");

    const toBase = (n: number): string => {
      const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      if (n < radix) return n < 36 ? n.toString(36) : alphabet[n] ?? "";
      return toBase(Math.floor(n / radix)) + (n % radix < 36 ? (n % radix).toString(36) : alphabet[n % radix]);
    };

    for (let i = count - 1; i >= 0; i--) {
      const word = dict[i];
      if (word) {
        const token = toBase(i);
        payload = payload.replace(new RegExp(`\\b${token}\\b`, "g"), word);
      }
    }
    // Unescape the common \' sequences.
    return payload.replace(/\\'/g, "'");
  } catch {
    return packed;
  }
}
