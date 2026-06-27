// Thin client over the Supabase edge functions. All app data flows through here.

import { config } from "@/config";
import type {
  Episode,
  Rail,
  Stream,
  Title,
  TitleDetails,
} from "./types";

function headers(): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/json" };
  if (config.anonKey) {
    h["apikey"] = config.anonKey;
    h["Authorization"] = `Bearer ${config.anonKey}`;
  }
  return h;
}

async function get<T>(fn: string, params: Record<string, string | number> = {}): Promise<T> {
  const qs = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  ).toString();
  const url = `${config.apiBase}/${fn}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`${fn} failed: ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  /** Curated rails for the Home screen. */
  home(): Promise<{ rails: Rail[] }> {
    return get("tmdb", { action: "home" });
  },

  search(query: string): Promise<{ results: Title[] }> {
    return get("tmdb", { action: "search", q: query });
  },

  details(type: "movie" | "series", id: string): Promise<TitleDetails> {
    return get("tmdb", { action: "details", kind: type === "series" ? "tv" : "movie", id });
  },

  season(id: string, season: number): Promise<{ episodes: Episode[] }> {
    return get("tmdb", { action: "season", id, season });
  },

  recommendations(type: "movie" | "series", id: string): Promise<{ results: Title[] }> {
    return get("tmdb", {
      action: "recommendations",
      kind: type === "series" ? "tv" : "movie",
      id,
    });
  },

  byGenre(type: "movie" | "series", genreId: number, page = 1): Promise<{ results: Title[] }> {
    return get("tmdb", {
      action: "genre",
      kind: type === "series" ? "tv" : "movie",
      genreId,
      page,
    });
  },

  /** Resolve playable streams for a movie or a specific episode. */
  streams(args: {
    id: string;
    type: "movie" | "series";
    season?: number;
    episode?: number;
  }): Promise<{ streams: Stream[] }> {
    const params: Record<string, string | number> = { id: args.id, type: args.type };
    if (args.season != null) params.season = args.season;
    if (args.episode != null) params.episode = args.episode;
    return get("streams", params);
  },
};
