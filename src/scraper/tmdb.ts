import { readConfig } from "../utils/config.js";
import { logger } from "../utils/logger.js";
import type { SearchResult } from "./types.js";

// cineby/videasy expose an open, keyless TMDB mirror. We use it by default so
// the tool works with zero configuration. If the user supplies their own TMDB
// key in config we hit the official API instead (no shared rate limits).
const PROXY_BASES = ["https://db.videasy.to/3", "https://api.themoviedb.org/3"];
const OFFICIAL_BASE = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
const BACKDROP_BASE = "https://image.tmdb.org/t/p/w780";
const STILL_BASE = "https://image.tmdb.org/t/p/w300";

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

/**
 * Resolve the ordered list of TMDB base URLs and the key query param, honoring
 * a user-supplied key when present. Shared by every fetcher below.
 */
async function resolveBases(): Promise<{ bases: string[]; keyParam: string }> {
  const config = await readConfig();
  const bases = config.tmdbApiKey ? [OFFICIAL_BASE, ...PROXY_BASES] : PROXY_BASES;
  const keyParam = config.tmdbApiKey ? `&api_key=${config.tmdbApiKey}` : "";
  return { bases, keyParam };
}

/** GET the first base that returns JSON; null if every base fails. */
async function tmdbGet<T>(path: string, query = ""): Promise<T | null> {
  const { bases, keyParam } = await resolveBases();
  for (const base of bases) {
    const params = [query, keyParam.replace(/^&/, "")].filter(Boolean).join("&");
    const url = `${base}${path}${params ? `?${params}` : ""}`;
    try {
      const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA } });
      if (!res.ok) {
        logger.debug(`TMDB ${path} via ${base} returned ${res.status}`);
        continue;
      }
      return (await res.json()) as T;
    } catch (err) {
      logger.debug(`TMDB ${path} via ${base} threw:`, err);
    }
  }
  return null;
}

export interface Genre {
  id: number;
  name: string;
}

/** Movie + TV genre dictionaries merged into a single id→name map. */
export async function fetchGenres(): Promise<Genre[]> {
  const [movie, tv] = await Promise.all([
    tmdbGet<{ genres?: Genre[] }>("/genre/movie/list", "language=en"),
    tmdbGet<{ genres?: Genre[] }>("/genre/tv/list", "language=en"),
  ]);
  const map = new Map<number, string>();
  for (const g of [...(movie?.genres ?? []), ...(tv?.genres ?? [])]) map.set(g.id, g.name);
  return [...map.entries()].map(([id, name]) => ({ id, name }));
}

/**
 * Trending titles for the home screen. `media` is "all", "movie", or "tv";
 * `window` is "day" or "week".
 */
export async function fetchTrending(
  provider: string,
  media: "all" | "movie" | "tv" = "all",
  window: "day" | "week" = "week",
): Promise<SearchResult[]> {
  const data = await tmdbGet<{ results?: TmdbItem[] }>(`/trending/${media}/${window}`, "language=en");
  return (data?.results ?? [])
    .filter((i) => i.media_type !== "person")
    .map((i) => normalize(i, provider));
}

/** Popular/top-rated rails. `kind` is "movie" or "tv". */
export async function fetchList(
  provider: string,
  kind: "movie" | "tv",
  list: "popular" | "top_rated" | "now_playing" | "airing_today" = "popular",
  page = 1,
): Promise<SearchResult[]> {
  const data = await tmdbGet<{ results?: TmdbItem[] }>(`/${kind}/${list}`, `language=en&page=${page}`);
  const fallbackType = kind === "tv" ? "tv" : "movie";
  return (data?.results ?? []).map((i) => normalize({ ...i, media_type: i.media_type ?? fallbackType }, provider));
}

/** Discover titles by genre id. Used to power category browsing. */
export async function discoverByGenre(
  provider: string,
  kind: "movie" | "tv",
  genreId: number,
  page = 1,
): Promise<SearchResult[]> {
  const data = await tmdbGet<{ results?: TmdbItem[] }>(
    `/discover/${kind}`,
    `with_genres=${genreId}&sort_by=popularity.desc&language=en&page=${page}`,
  );
  return (data?.results ?? []).map((i) => normalize({ ...i, media_type: kind }, provider));
}

/** TMDB "recommendations" for a given title — the seed of our rec engine. */
export async function fetchRecommendations(
  provider: string,
  kind: "movie" | "tv",
  id: string,
): Promise<SearchResult[]> {
  const data = await tmdbGet<{ results?: TmdbItem[] }>(`/${kind}/${id}/recommendations`, "language=en");
  return (data?.results ?? []).map((i) => normalize({ ...i, media_type: kind }, provider));
}

export interface TitleDetails extends SearchResult {
  overview: string;
  backdrop: string | null;
  genres: Genre[];
  runtime: number | null;
  /** For series only. */
  seasons: SeasonSummary[];
  numberOfSeasons: number | null;
}

export interface SeasonSummary {
  seasonNumber: number;
  name: string;
  episodeCount: number;
  poster: string | null;
}

interface TmdbDetail extends TmdbItem {
  overview?: string;
  backdrop_path?: string | null;
  genres?: Genre[];
  runtime?: number;
  episode_run_time?: number[];
  number_of_seasons?: number;
  seasons?: Array<{
    season_number: number;
    name: string;
    episode_count: number;
    poster_path?: string | null;
  }>;
}

/** Full detail payload for a movie or series, including season list. */
export async function fetchDetails(
  provider: string,
  kind: "movie" | "tv",
  id: string,
): Promise<TitleDetails | null> {
  const d = await tmdbGet<TmdbDetail>(`/${kind}/${id}`, "language=en");
  if (!d) return null;
  const base = normalize({ ...d, media_type: kind }, provider);
  return {
    ...base,
    overview: d.overview ?? "",
    backdrop: d.backdrop_path ? `${BACKDROP_BASE}${d.backdrop_path}` : null,
    genres: d.genres ?? [],
    runtime: d.runtime ?? d.episode_run_time?.[0] ?? null,
    numberOfSeasons: d.number_of_seasons ?? null,
    seasons: (d.seasons ?? [])
      .filter((s) => s.season_number > 0)
      .map((s) => ({
        seasonNumber: s.season_number,
        name: s.name,
        episodeCount: s.episode_count,
        poster: s.poster_path ? `${IMAGE_BASE}${s.poster_path}` : null,
      })),
  };
}

export interface EpisodeInfo {
  episodeNumber: number;
  name: string;
  overview: string;
  still: string | null;
  airDate: string | null;
  runtime: number | null;
}

/** Episode list for a single season of a series. */
export async function fetchSeasonEpisodes(
  id: string,
  seasonNumber: number,
): Promise<EpisodeInfo[]> {
  const data = await tmdbGet<{
    episodes?: Array<{
      episode_number: number;
      name: string;
      overview: string;
      still_path?: string | null;
      air_date?: string | null;
      runtime?: number | null;
    }>;
  }>(`/tv/${id}/season/${seasonNumber}`, "language=en");
  return (data?.episodes ?? []).map((e) => ({
    episodeNumber: e.episode_number,
    name: e.name,
    overview: e.overview ?? "",
    still: e.still_path ? `${STILL_BASE}${e.still_path}` : null,
    airDate: e.air_date ?? null,
    runtime: e.runtime ?? null,
  }));
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
