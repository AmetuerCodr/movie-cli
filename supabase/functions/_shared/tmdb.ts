// Deno-native TMDB client for the edge runtime. Pure fetch, no node deps.
//
// If TMDB_API_KEY is set in the function's environment we hit the official API.
// Otherwise we fall back to the open keyless mirror that the original CLI used,
// so the whole thing works with zero configuration for development.

import type {
  Episode,
  Genre,
  SeasonSummary,
  Title,
  TitleDetails,
} from "./types.ts";

const OFFICIAL_BASE = "https://api.themoviedb.org/3";
const PROXY_BASE = "https://db.videasy.to/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
const BACKDROP_BASE = "https://image.tmdb.org/t/p/w780";
const STILL_BASE = "https://image.tmdb.org/t/p/w300";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const API_KEY = Deno.env.get("TMDB_API_KEY") ?? "";
// Default provider that resolves streams. Overridable per-deploy.
const DEFAULT_PROVIDER = Deno.env.get("STREAM_PROVIDER") ?? "cineby";

function bases(): string[] {
  // Prefer the official API when a key is configured, with the mirror as a
  // resilience fallback; otherwise the mirror only.
  return API_KEY ? [OFFICIAL_BASE, PROXY_BASE] : [PROXY_BASE, OFFICIAL_BASE];
}

async function get<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
  const search = new URLSearchParams({ language: "en", ...params });
  if (API_KEY) search.set("api_key", API_KEY);
  const qs = search.toString();
  for (const base of bases()) {
    try {
      const res = await fetch(`${base}${path}?${qs}`, {
        headers: { Accept: "application/json", "User-Agent": UA },
      });
      if (!res.ok) continue;
      return (await res.json()) as T;
    } catch {
      // try next base
    }
  }
  return null;
}

interface RawItem {
  id: number;
  title?: string;
  name?: string;
  media_type?: string;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  poster_path?: string | null;
}

function normalize(item: RawItem, fallbackKind?: "movie" | "tv"): Title {
  const isTv =
    item.media_type === "tv" ||
    (fallbackKind === "tv") ||
    (!item.title && !!item.name);
  const title = item.title ?? item.name ?? "Untitled";
  const dateStr = item.release_date ?? item.first_air_date ?? null;
  const year = dateStr ? Number(dateStr.slice(0, 4)) : null;
  return {
    id: String(item.id),
    title,
    year: year != null && !Number.isNaN(year) ? year : null,
    type: isTv ? "series" : "movie",
    rating: item.vote_average ?? null,
    poster: item.poster_path ? `${IMAGE_BASE}${item.poster_path}` : null,
    provider: DEFAULT_PROVIDER,
  };
}

function mapResults(items: RawItem[] | undefined, fallbackKind?: "movie" | "tv"): Title[] {
  return (items ?? [])
    .filter((i) => i.media_type !== "person")
    .map((i) => normalize(i, fallbackKind));
}

export async function search(query: string): Promise<Title[]> {
  const data = await get<{ results?: RawItem[] }>("/search/multi", { query });
  return mapResults(data?.results);
}

export async function trending(
  media: "all" | "movie" | "tv" = "all",
  window: "day" | "week" = "week",
): Promise<Title[]> {
  const data = await get<{ results?: RawItem[] }>(`/trending/${media}/${window}`);
  return mapResults(data?.results, media === "tv" ? "tv" : undefined);
}

export async function list(
  kind: "movie" | "tv",
  which: "popular" | "top_rated" | "now_playing" | "airing_today" = "popular",
  page = 1,
): Promise<Title[]> {
  const data = await get<{ results?: RawItem[] }>(`/${kind}/${which}`, { page: String(page) });
  return mapResults(data?.results, kind);
}

export async function discover(
  kind: "movie" | "tv",
  genreId: number,
  page = 1,
): Promise<Title[]> {
  const data = await get<{ results?: RawItem[] }>(`/discover/${kind}`, {
    with_genres: String(genreId),
    sort_by: "popularity.desc",
    page: String(page),
  });
  return mapResults(data?.results, kind);
}

export async function recommendations(kind: "movie" | "tv", id: string): Promise<Title[]> {
  const data = await get<{ results?: RawItem[] }>(`/${kind}/${id}/recommendations`);
  return mapResults(data?.results, kind);
}

export async function genres(): Promise<Genre[]> {
  const [movie, tv] = await Promise.all([
    get<{ genres?: Genre[] }>("/genre/movie/list"),
    get<{ genres?: Genre[] }>("/genre/tv/list"),
  ]);
  const map = new Map<number, string>();
  for (const g of [...(movie?.genres ?? []), ...(tv?.genres ?? [])]) map.set(g.id, g.name);
  return [...map.entries()].map(([id, name]) => ({ id, name }));
}

interface RawDetail extends RawItem {
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

export async function details(
  kind: "movie" | "tv",
  id: string,
): Promise<TitleDetails | null> {
  const d = await get<RawDetail>(`/${kind}/${id}`);
  if (!d) return null;
  const base = normalize({ ...d, media_type: kind }, kind);
  const seasons: SeasonSummary[] = (d.seasons ?? [])
    .filter((s) => s.season_number > 0)
    .map((s) => ({
      seasonNumber: s.season_number,
      name: s.name,
      episodeCount: s.episode_count,
      poster: s.poster_path ? `${IMAGE_BASE}${s.poster_path}` : null,
    }));
  return {
    ...base,
    overview: d.overview ?? "",
    backdrop: d.backdrop_path ? `${BACKDROP_BASE}${d.backdrop_path}` : null,
    genres: d.genres ?? [],
    runtime: d.runtime ?? d.episode_run_time?.[0] ?? null,
    numberOfSeasons: d.number_of_seasons ?? null,
    seasons,
  };
}

export async function seasonEpisodes(id: string, season: number): Promise<Episode[]> {
  const data = await get<{
    episodes?: Array<{
      episode_number: number;
      name: string;
      overview: string;
      still_path?: string | null;
      air_date?: string | null;
      runtime?: number | null;
    }>;
  }>(`/tv/${id}/season/${season}`);
  return (data?.episodes ?? []).map((e) => ({
    episodeNumber: e.episode_number,
    name: e.name,
    overview: e.overview ?? "",
    still: e.still_path ? `${STILL_BASE}${e.still_path}` : null,
    airDate: e.air_date ?? null,
    runtime: e.runtime ?? null,
  }));
}
