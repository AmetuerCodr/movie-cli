import { readConfig } from "../utils/config.js";
import { logger } from "../utils/logger.js";
import type { SearchResult } from "./types.js";

// cineby/videasy expose an open, keyless TMDB mirror. We use it by default so
// the tool works with zero configuration. If the user supplies their own TMDB
// key in config we hit the official API instead (no shared rate limits).
const PROXY_BASES = ["https://db.videasy.to/3", "https://api.themoviedb.org/3"];
const OFFICIAL_BASE = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p/w500";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

interface TmdbItem {
  id: number;
  title?: string;
  name?: string;
  media_type?: string;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  poster_path?: string | null;
}

/**
 * Search TMDB (multi) and return normalized results tagged with `provider`.
 * Uses the open proxy unless a user TMDB key is configured.
 */
export async function searchTmdb(query: string, provider: string): Promise<SearchResult[]> {
  const config = await readConfig();
  const bases = config.tmdbApiKey ? [OFFICIAL_BASE, ...PROXY_BASES] : PROXY_BASES;
  const keyParam = config.tmdbApiKey ? `&api_key=${config.tmdbApiKey}` : "";

  for (const base of bases) {
    const url = `${base}/search/multi?query=${encodeURIComponent(query)}&language=en${keyParam}`;
    try {
      const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA } });
      if (!res.ok) {
        logger.debug(`TMDB search ${base} returned ${res.status}`);
        continue;
      }
      const data = (await res.json()) as { results?: TmdbItem[] };
      const items = data.results ?? [];
      const mapped = items
        .filter((i) => i.media_type !== "person")
        .map((i) => normalize(i, provider));
      if (mapped.length > 0) return mapped;
    } catch (err) {
      logger.debug(`TMDB search ${base} threw:`, err);
    }
  }
  return [];
}

function normalize(item: TmdbItem, provider: string): SearchResult {
  const type: SearchResult["type"] =
    item.media_type === "tv" || (!item.title && !!item.name) ? "series" : "movie";
  const title = item.title ?? item.name ?? "Untitled";
  const dateStr = item.release_date ?? item.first_air_date ?? null;
  const year = dateStr ? Number(dateStr.slice(0, 4)) : null;

  return {
    id: String(item.id),
    title,
    year: year != null && !Number.isNaN(year) ? year : null,
    type,
    rating: item.vote_average != null ? item.vote_average : null,
    poster: item.poster_path ? `${IMAGE_BASE}${item.poster_path}` : null,
    provider,
  };
}
